// GET /api/logs/:id 单条完整追溯（含 response、告警、工单）
import type { Env } from '../../_lib/env';
import { HttpError, camel, json } from '../../_lib/http';
import { all, first } from '../../_lib/db';

export const onRequestGet: PagesFunction<Env> = async ({ params, env }) => {
  const id = String(params.id);
  const row = await first<Record<string, unknown>>(env.DB, 'SELECT * FROM qa_logs WHERE id = ?', id);
  if (!row) throw new HttpError(404, 'NOT_FOUND', '问答记录不存在');
  let response: unknown = null;
  try { response = JSON.parse(String(row.response_json)); } catch { /* keep null */ }
  const { response_json: _omit, ...rest } = row;
  const alerts = await all(env.DB, 'SELECT * FROM alerts WHERE qa_id = ? ORDER BY ts', id);
  const tickets = await all(env.DB, 'SELECT * FROM tickets WHERE qa_id = ?', id);
  return json({ ...camel(rest), response, alerts: alerts.map((a) => camel(a)), tickets: tickets.map((t) => camel(t)) });
};
