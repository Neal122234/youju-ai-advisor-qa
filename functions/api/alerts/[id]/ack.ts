// POST /api/alerts/:id/ack {by?}
import type { Env } from '../../../_lib/env';
import { HttpError, json, nowIso, readJson } from '../../../_lib/http';
import { first, run } from '../../../_lib/db';

export const onRequestPost: PagesFunction<Env> = async ({ params, request, env }) => {
  const id = String(params.id);
  const b = await readJson<{ by?: string }>(request);
  const a = await first(env.DB, 'SELECT id FROM alerts WHERE id = ?', id);
  if (!a) throw new HttpError(404, 'NOT_FOUND', '告警不存在');
  const ts = nowIso();
  await run(env.DB, `UPDATE alerts SET status = 'ack', handled_by = ?, handled_at = ? WHERE id = ?`, (b.by ?? '合规运营').slice(0, 40), ts, id);
  return json({ ok: true, id, status: 'ack', handledAt: ts });
};
