// GET /api/alerts?status=&category=
import type { Env } from '../../_lib/env';
import { camel, json } from '../../_lib/http';
import { all } from '../../_lib/db';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const u = new URL(request.url);
  const where: string[] = []; const args: unknown[] = [];
  const status = u.searchParams.get('status'); const cat = u.searchParams.get('category');
  if (status) { where.push('status = ?'); args.push(status); }
  if (cat) { where.push('category = ?'); args.push(cat); }
  const limit = Math.min(500, Number(u.searchParams.get('limit')) || 200);
  const rows = await all(env.DB, `SELECT * FROM alerts ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ts DESC LIMIT ?`, ...args, limit);
  return json({ items: rows.map((r) => camel(r)) });
};
