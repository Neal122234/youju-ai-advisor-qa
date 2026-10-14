// GET /api/logs?decision=&q=&limit=
import type { Env } from '../../_lib/env';
import { camel, json } from '../../_lib/http';
import { all } from '../../_lib/db';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const u = new URL(request.url);
  const where: string[] = []; const args: unknown[] = [];
  const decision = u.searchParams.get('decision'); const q = u.searchParams.get('q');
  const session = u.searchParams.get('session');
  if (decision) { const ds = decision.split(','); where.push(`decision IN (${ds.map(() => '?').join(',')})`); args.push(...ds); }
  if (q) { where.push('(question LIKE ? OR answer LIKE ? OR id = ?)'); args.push(`%${q}%`, `%${q}%`, q); }
  if (session) { where.push('session_id = ?'); args.push(session); }
  const limit = Math.min(500, Math.max(1, Number(u.searchParams.get('limit')) || 100));
  const rows = await all(env.DB, `SELECT id, ts, session_id, question, user_risk, decision, confidence, answer, kb_release, mode, latency_ms, feedback, feedback_note
    FROM qa_logs ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ts DESC LIMIT ?`, ...args, limit);
  return json({ items: rows.map((r) => camel(r)) });
};
