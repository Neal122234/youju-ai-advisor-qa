// GET /api/tickets?status=
import type { Env } from '../../_lib/env';
import { camel, json } from '../../_lib/http';
import { all } from '../../_lib/db';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const status = new URL(request.url).searchParams.get('status');
  const rows = await all(env.DB, `SELECT t.*, q.question, q.decision, q.user_risk FROM tickets t LEFT JOIN qa_logs q ON q.id = t.qa_id
    ${status ? 'WHERE t.status = ?' : ''} ORDER BY CASE t.status WHEN 'pending' THEN 0 WHEN 'processing' THEN 1 ELSE 2 END, t.created_at DESC LIMIT 300`, ...(status ? [status] : []));
  return json({ items: rows.map((r) => camel(r)) });
};
