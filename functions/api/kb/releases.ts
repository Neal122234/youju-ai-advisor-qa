// GET /api/kb/releases
import type { Env } from '../../_lib/env';
import { camel, json } from '../../_lib/http';
import { all, safeArr } from '../../_lib/db';

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const rows = await all<any>(env.DB, 'SELECT * FROM releases ORDER BY seq DESC LIMIT 200');
  return json({ items: rows.map((r) => ({ ...camel(r), docVersions: safeArr(r.doc_versions_json) })) });
};
