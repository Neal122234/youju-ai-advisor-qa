// POST /api/alerts/:id/ack {by?}
import type { Env } from '../../../_lib/env';
import { HttpError, json, nowIso, readJson } from '../../../_lib/http';
import { first, run } from '../../../_lib/db';

export const onRequestPost: PagesFunction<Env> = async ({ params, request, env }) => {
  const id = String(params.id);
  const b = await readJson<{ by?: string }>(request);
  const a = await first<{ id: string; status: string; handled_by: string | null; handled_at: string | null }>(env.DB, 'SELECT id, status, handled_by, handled_at FROM alerts WHERE id = ?', id);
  if (!a) throw new HttpError(404, 'NOT_FOUND', '告警不存在');
  // 幂等：已确认的告警不覆盖处理人与时间
  if (a.status === 'ack') return json({ ok: true, id, status: 'ack', handledBy: a.handled_by, handledAt: a.handled_at, already: true });
  const ts = nowIso();
  const by = typeof b.by === 'string' && b.by.trim() ? b.by.slice(0, 40) : '合规运营';
  await run(env.DB, `UPDATE alerts SET status = 'ack', handled_by = ?, handled_at = ? WHERE id = ? AND status = 'open'`, by, ts, id);
  return json({ ok: true, id, status: 'ack', handledBy: by, handledAt: ts });
};
