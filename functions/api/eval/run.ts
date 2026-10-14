// POST /api/eval/run {ids?, llm?=true, offset?, limit?} → 逐题结果与通过率（core/eval.ts summarize 结构）
// 线上免费额度/子请求有限：查询向量一次批量计算；同题命中 10 分钟缓存；可用 offset/limit 或 ids 分批跑。
import type { Env } from '../../_lib/env';
import { HttpError, json, readJson } from '../../_lib/http';
import { answer } from '../../_lib/chat';
import { canEmbed, embedTexts, parseProvider, providerState } from '../../_lib/ai';
import { loadKb } from '../../_lib/db';
import { judge, summarize, type EvalQuestion, type EvalResult } from '../../../core/eval';
import { analyzeInput, maskPII } from '../../../core/compliance';
import { sanitizeInput } from '../../../core/pipeline';
import questions from '../../../eval/questions.json';

const ALL = questions as unknown as EvalQuestion[];

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const b = await readJson<{ ids?: string[]; llm?: boolean; offset?: number; limit?: number; persist?: boolean }>(request);
  // 参数校验：ids 必须是字符串数组；offset/limit 必须是整数（limit 1..200，缺省=全部）
  if (b.ids !== undefined && !(Array.isArray(b.ids) && b.ids.every((x) => typeof x === 'string'))) throw new HttpError(400, 'BAD_INPUT', 'ids 必须是字符串数组');
  if (b.offset !== undefined && !(Number.isInteger(b.offset) && (b.offset as number) >= 0)) throw new HttpError(400, 'BAD_INPUT', 'offset 必须是 ≥0 的整数');
  if (b.limit !== undefined && !(Number.isInteger(b.limit) && (b.limit as number) >= 1 && (b.limit as number) <= 200)) throw new HttpError(400, 'BAD_INPUT', 'limit 必须是 1–200 的整数');
  let list = Array.isArray(b.ids) && b.ids.length ? ALL.filter((q) => b.ids!.includes(q.id)) : ALL;
  const offset = (b.offset as number | undefined) ?? 0;
  const limit = (b.limit as number | undefined) ?? Math.min(200, list.length || 1);
  list = list.slice(offset, offset + limit);
  const kb = await loadKb(env.DB);
  const tok0 = providerState().sfTokens;
  // 预计算查询向量（与管线内检索文本口径一致）
  const embedCache = new Map<string, number[]>();
  const provider = parseProvider(request);
  if (kb.source === 'd1' && kb.embedded > 0 && canEmbed(env)) {
    const texts = [...new Set(list.map((q) => {
      const s = sanitizeInput(q.question).text; const a = analyzeInput(s);
      return maskPII(a.verdict === 'mixed' || a.injection ? a.compliantText : s, true);
    }))];
    try { const vs = await embedTexts(env, texts, new Set(), provider); texts.forEach((t, i) => embedCache.set(t, vs[i])); } catch { /* 单题内再试 */ }
  }
  const results: EvalResult[] = new Array(list.length);
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const i = next++; const q = list[i];
      try {
        const r = await answer(env, { question: q.question, userRisk: q.userRisk, sessionId: 'eval' }, new Set(), { kb, embedCache, noLlm: b.llm === false, sessionTag: 'eval', persist: b.persist !== false, provider });
        results[i] = judge(q, r);
      } catch (e) { results[i] = judge(q, null, e instanceof Error ? e.message : String(e)); }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  const s = summarize(results, kb.release);
  return json({ ...s, sfTokens: providerState().sfTokens - tok0, offset, limit, totalQuestions: ALL.length, mode: b.llm === false ? 'no-llm' : 'llm', nextOffset: offset + list.length < (b.ids?.length ? ALL.filter((q) => b.ids!.includes(q.id)).length : ALL.length) ? offset + list.length : null });
};
