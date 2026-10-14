// Workers AI 适配：LLM（主 qwen3，失败回退 gpt-oss 一次，整体 12s 预算）+ bge-m3 批量 embedding + x-fault 故障注入。
import type { LlmFn, LlmMessage } from '../../core/types';
import { stripThink } from '../../core/pipeline';
import type { AiBinding, Env, Fault } from './env';
import { mockAi } from './mockAi';

export const MODEL_MAIN = '@cf/qwen/qwen3-30b-a3b-fp8';
export const MODEL_FALLBACK = '@cf/openai/gpt-oss-120b';
export const MODEL_EMBED = '@cf/baai/bge-m3';
export const LLM_TIMEOUT_MS = 12_000;
export const EMBED_BATCH = 50;          // bge-m3 单次上限约 100 条，留余量
export const EMBED_TIMEOUT_MS = 15_000;

export class TimeoutError extends Error { constructor(label: string, ms: number) { super(`${label} 超时（${ms}ms）`); } }

export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let t: ReturnType<typeof setTimeout>;
  return Promise.race([p, new Promise<T>((_r, rej) => { t = setTimeout(() => rej(new TimeoutError(label, ms)), ms); })]).finally(() => clearTimeout(t));
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 兼容 Workers AI 各种返回形态：string / {response} / OpenAI choices / Responses API output[] */
export function extractText(result: unknown): string {
  if (result == null) return '';
  if (typeof result === 'string') return stripThink(result);
  const r = result as Record<string, any>;
  if (typeof r.response === 'string') return stripThink(r.response);
  if (r.response && typeof r.response === 'object') return stripThink(JSON.stringify(r.response));
  const c = r.choices?.[0];
  if (c) {
    const content = c.message?.content ?? c.text ?? c.delta?.content;
    if (typeof content === 'string') return stripThink(content);
    if (Array.isArray(content)) return stripThink(content.map((p: any) => p?.text ?? '').join(''));
  }
  if (typeof r.output_text === 'string') return stripThink(r.output_text);
  if (Array.isArray(r.output)) {
    const parts: string[] = [];
    for (const o of r.output) {
      if (o?.type === 'reasoning') continue;
      if (typeof o?.content === 'string') parts.push(o.content);
      else if (Array.isArray(o?.content)) for (const p of o.content) if (typeof p?.text === 'string') parts.push(p.text);
    }
    if (parts.length) return stripThink(parts.join(''));
  }
  if (typeof r.result === 'object') return extractText(r.result);
  return '';
}

async function callModel(ai: AiBinding, model: string, messages: LlmMessage[], maxTokens: number): Promise<string> {
  if (model === MODEL_FALLBACK) {
    // gpt-oss 走 Responses 风格入参
    const sys = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
    const rest = messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role, content: m.content }));
    const res = await ai.run(model, { instructions: sys, input: rest, reasoning: { effort: 'low' }, max_output_tokens: maxTokens });
    return extractText(res);
  }
  // qwen3：/no_think 关闭思考，降低延迟；仍兼容可能返回的 <think>
  const msgs = messages.map((m, i) => (i === messages.length - 1 && m.role === 'user' ? { ...m, content: `${m.content}\n/no_think` } : m));
  const res = await ai.run(model, { messages: msgs, max_tokens: maxTokens, temperature: 0.2 });
  return extractText(res);
}

export interface LlmHandle { llm: LlmFn | null; modelName: () => string | null; calls: () => number }

/** 生成 LLM 函数：主模型 → 失败且剩余预算 >3s 时回退一次；整体不超过 12s。 */
export function createLlm(env: Env, faults: Set<Fault>, budgetMs = LLM_TIMEOUT_MS): LlmHandle {
  let used: string | null = null; let calls = 0;
  if (!env.AI) return { llm: null, modelName: () => null, calls: () => 0 };
  const ai = env.AI;
  const llm: LlmFn = async (messages, o) => {
    const deadline = Date.now() + budgetMs;
    const maxTokens = o?.maxTokens ?? 700;
    const attempt = async (model: string) => {
      calls++;
      const left = deadline - Date.now();
      if (left <= 0) throw new TimeoutError('LLM', budgetMs);
      const p = (async () => {
        if (faults.has('llm')) throw new Error(`故障注入：${model} 不可用`);
        if (faults.has('slow-llm')) await sleep(budgetMs + 1000);
        return callModel(ai, model, messages, maxTokens);
      })();
      const text = await withTimeout(p, left, `LLM(${model})`);
      if (!text.trim()) throw new Error(`${model} 返回空内容`);
      used = ai === mockAi ? `mock(${model})` : model;
      return text;
    };
    try { return await attempt(MODEL_MAIN); }
    catch (e) {
      if (e instanceof TimeoutError || deadline - Date.now() < 3000) throw e;
      return await attempt(MODEL_FALLBACK);
    }
  };
  return { llm, modelName: () => used, calls: () => calls };
}

/** 批量 embedding（每批 ≤50 条）。返回与 texts 等长的向量数组。 */
export async function embedTexts(env: Env, texts: string[], faults: Set<Fault> = new Set()): Promise<number[][]> {
  if (faults.has('embed')) throw new Error('故障注入：embedding 服务不可用');
  if (!env.AI) throw new Error('AI binding 未配置');
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const batch = texts.slice(i, i + EMBED_BATCH).map((t) => t.slice(0, 2000));
    const res = (await withTimeout(env.AI.run(MODEL_EMBED, { text: batch }), EMBED_TIMEOUT_MS, 'embedding')) as { data?: number[][] };
    if (!Array.isArray(res?.data) || res.data.length !== batch.length) throw new Error('embedding 返回格式异常');
    out.push(...res.data);
  }
  return out;
}

/** 存库用：保留 5 位小数，压缩 JSON 体积 */
export const packEmbedding = (v: number[]) => JSON.stringify(v.map((x) => Math.round(x * 1e5) / 1e5));
