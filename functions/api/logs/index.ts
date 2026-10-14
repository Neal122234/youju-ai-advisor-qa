// GET /api/logs?decision=&q=&limit=&offset=&sort=ts|confidence|latency|risk&dir=asc|desc → {items, total}
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
  const offset = Math.max(0, Math.floor(Number(u.searchParams.get('offset')) || 0));
  // 排序列走白名单，不拼接用户输入
  const SORT: Record<string, string> = { ts: 'ts', confidence: 'confidence', latency: 'latency_ms', risk: 'user_risk' };
  const col = SORT[u.searchParams.get('sort') ?? 'ts'] ?? 'ts';
  const dir = u.searchParams.get('dir') === 'asc' ? 'ASC' : 'DESC';
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const rows = await all(env.DB, `SELECT id, ts, session_id, question, user_risk, decision, confidence, answer, kb_release, mode, latency_ms, feedback, feedback_note
    FROM qa_logs ${w} ORDER BY ${col} ${dir}, ts DESC LIMIT ? OFFSET ?`, ...args, limit, offset);
  const cnt = await all<{ n: number }>(env.DB, `SELECT COUNT(*) AS n FROM qa_logs ${w}`, ...args);
  return json({ items: rows.map((r) => camel(r)), total: Number(cnt[0]?.n ?? rows.length), offset, limit });
};
