// POST /api/tickets/:id {status, reply?, assignee?}
import type { Env } from '../../_lib/env';
import { HttpError, camel, json, nowIso, readJson } from '../../_lib/http';
import { first, run } from '../../_lib/db';

const STATUSES = ['pending', 'processing', 'closed'];
export const onRequestPost: PagesFunction<Env> = async ({ params, request, env }) => {
  const id = String(params.id);
  const b = await readJson<{ status?: string; reply?: string; assignee?: string; reopen?: boolean }>(request);
  const t = await first<any>(env.DB, 'SELECT * FROM tickets WHERE id = ?', id);
  if (!t) throw new HttpError(404, 'NOT_FOUND', '工单不存在');
  if (b.status !== undefined && (typeof b.status !== 'string' || !STATUSES.includes(b.status))) throw new HttpError(400, 'BAD_INPUT', `status 只能是 ${STATUSES.join('/')}`);
  if (b.reply !== undefined && typeof b.reply !== 'string') throw new HttpError(400, 'BAD_INPUT', 'reply 必须是字符串');
  if (b.assignee !== undefined && typeof b.assignee !== 'string') throw new HttpError(400, 'BAD_INPUT', 'assignee 必须是字符串');
  // 状态机：pending→processing/closed；processing→pending/closed；closed 只能通过 {reopen:true} 重开为 processing
  const ALLOWED: Record<string, string[]> = { pending: ['pending', 'processing', 'closed'], processing: ['processing', 'pending', 'closed'], closed: ['closed'] };
  let next = b.status ?? t.status;
  if (b.reopen === true && t.status === 'closed') next = 'processing';
  else if (!ALLOWED[t.status]?.includes(next)) throw new HttpError(409, 'INVALID_TRANSITION', `工单状态不能从 ${t.status} 直接改为 ${next}（已关闭的工单请传 {"reopen":true} 重开）`);
  await run(env.DB, 'UPDATE tickets SET status = ?, reply = ?, assignee = ?, updated_at = ? WHERE id = ?',
    next, typeof b.reply === 'string' ? b.reply.slice(0, 2000) : t.reply, typeof b.assignee === 'string' ? b.assignee.slice(0, 40) : (t.assignee ?? '人工客服'), nowIso(), id);
  return json({ ok: true, ticket: camel(await first(env.DB, 'SELECT * FROM tickets WHERE id = ?', id)) });
};
