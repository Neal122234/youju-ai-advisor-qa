// POST /api/gaps/:id/verify 用当前 release 重跑该缺口全部问题（≤10 条），全部非 handoff → resolved
import type { Env } from '../../../_lib/env';
import { HttpError, json } from '../../../_lib/http';
import { first, loadKb, run, safeArr } from '../../../_lib/db';
import { answer } from '../../../_lib/chat';

export const onRequestPost: PagesFunction<Env> = async ({ params, env }) => {
  const id = String(params.id);
  const gap = await first<any>(env.DB, 'SELECT * FROM gaps WHERE id = ?', id);
  if (!gap) throw new HttpError(404, 'NOT_FOUND', '缺口不存在');
  const kb = await loadKb(env.DB);
  const qs = [...new Set([gap.sample_question, ...safeArr(gap.questions_json)])].slice(0, 10);
  const results = [];
  for (const q of qs) {
    const r = await answer(env, { question: q, userRisk: 'C3', sessionId: `verify:${id}` }, new Set(), { kb, persist: true, sessionTag: `verify:${id}`, useCache: false });
    results.push({ question: q, decision: r.decision, confidence: r.confidence, qaId: r.id, citations: r.citations.map((c) => c.docKey) });
  }
  const resolved = results.every((r) => !r.decision.startsWith('handoff'));
  if (resolved) await run(env.DB, `UPDATE gaps SET status = 'resolved', resolved_release = ? WHERE id = ?`, kb.release, id);
  return json({ resolved, release: kb.release, resolved_release: resolved ? kb.release : null, resolvedRelease: resolved ? kb.release : null, gapId: id, status: resolved ? 'resolved' : gap.status, results });
};
