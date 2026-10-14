// GET /api/gaps?status=
import type { Env } from '../../_lib/env';
import { camel, json } from '../../_lib/http';
import { all, safeArr } from '../../_lib/db';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const status = new URL(request.url).searchParams.get('status');
  const ss = status ? status.split(',') : [];
  const rows = await all<any>(env.DB, `SELECT g.*, (SELECT id FROM doc_versions v WHERE v.gap_id = g.id ORDER BY v.created_at DESC LIMIT 1) AS draft_version_id
    FROM gaps g ${ss.length ? `WHERE g.status IN (${ss.map(() => '?').join(',')})` : ''} ORDER BY CASE g.status WHEN 'open' THEN 0 WHEN 'drafting' THEN 1 ELSE 2 END, g.count DESC, g.last_seen DESC LIMIT 300`, ...ss);
  return json({ items: rows.map((r) => ({ ...camel(r), questions: safeArr(r.questions_json) })) });
};
