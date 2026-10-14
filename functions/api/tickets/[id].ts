// POST /api/tickets/:id {status, reply?, assignee?}
import type { Env } from '../../_lib/env';
import { HttpError, camel, json, nowIso, readJson } from '../../_lib/http';
import { first, run } from '../../_lib/db';

const STATUSES = ['pending', 'processing', 'closed'];
export const onRequestPost: PagesFunction<Env> = async ({ params, request, env }) => {
  const id = String(params.id);
  const b = await readJson<{ status?: string; reply?: string; assignee?: string }>(request);
  const t = await first<any>(env.DB, 'SELECT * FROM tickets WHERE id = ?', id);
  if (!t) throw new HttpError(404, 'NOT_FOUND', '工单不存在');
  if (b.status && !STATUSES.includes(b.status)) throw new HttpError(400, 'BAD_INPUT', `status 只能是 ${STATUSES.join('/')}`);
  await run(env.DB, 'UPDATE tickets SET status = ?, reply = ?, assignee = ?, updated_at = ? WHERE id = ?',
    b.status ?? t.status, typeof b.reply === 'string' ? b.reply.slice(0, 2000) : t.reply, typeof b.assignee === 'string' ? b.assignee.slice(0, 40) : (t.assignee ?? '人工客服'), nowIso(), id);
  return json({ ok: true, ticket: camel(await first(env.DB, 'SELECT * FROM tickets WHERE id = ?', id)) });
};
