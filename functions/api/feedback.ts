// POST /api/feedback {qaId, helpful, note?}；差评 → gap(type=bad_feedback)
import type { Env } from '../_lib/env';
import { HttpError, json, readJson } from '../_lib/http';
import { first, run, upsertGap } from '../_lib/db';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const b = await readJson<{ qaId?: string; helpful?: boolean; note?: string }>(request);
  if (typeof b.qaId !== 'string' || !b.qaId || b.qaId.length > 80 || typeof b.helpful !== 'boolean') throw new HttpError(400, 'BAD_INPUT', '需要 qaId(string) 与 helpful(boolean)');
  if (b.note !== undefined && b.note !== null && typeof b.note !== 'string') throw new HttpError(400, 'BAD_INPUT', 'note 必须是字符串');
  const log = await first<{ id: string; question: string; feedback: number | null }>(env.DB, 'SELECT id, question, feedback FROM qa_logs WHERE id = ?', b.qaId);
  if (!log) throw new HttpError(404, 'NOT_FOUND', '问答记录不存在');
  const note = typeof b.note === 'string' ? b.note.slice(0, 500) : null;
  await run(env.DB, 'UPDATE qa_logs SET feedback = ?, feedback_note = ? WHERE id = ?', b.helpful ? 1 : 0, note, b.qaId);
  // 同一条记录重复差评不重复计入缺口
  const gapId = b.helpful || log.feedback === 0 ? null : await upsertGap(env.DB, log.question, 'bad_feedback');
  return json({ ok: true, gapId });
};
