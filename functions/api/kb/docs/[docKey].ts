// GET /api/kb/docs/:docKey 文档 + 全部版本
import type { Env } from '../../../_lib/env';
import { HttpError, camel, json } from '../../../_lib/http';
import { all, first, safeArr } from '../../../_lib/db';

export const onRequestGet: PagesFunction<Env> = async ({ params, env }) => {
  const docKey = String(params.docKey);
  const d = await first<any>(env.DB, `SELECT d.*, (SELECT COUNT(*) FROM chunks c WHERE c.doc_key = d.doc_key AND c.active = 1) AS chunks,
    (SELECT version FROM doc_versions v WHERE v.doc_key = d.doc_key AND v.status = 'published' ORDER BY version DESC LIMIT 1) AS current_version,
    (SELECT COUNT(*) FROM doc_versions v WHERE v.doc_key = d.doc_key AND v.status = 'draft') AS draft_count,
    (SELECT MAX(COALESCE(published_at, created_at)) FROM doc_versions v WHERE v.doc_key = d.doc_key) AS updated_at
    FROM documents d WHERE d.doc_key = ?`, docKey);
  if (!d) throw new HttpError(404, 'NOT_FOUND', `文档不存在：${docKey}`);
  const versions = await all(env.DB, 'SELECT * FROM doc_versions WHERE doc_key = ? ORDER BY version DESC', docKey);
  const chunks = await all(env.DB, 'SELECT id, ord, heading, text, version FROM chunks WHERE doc_key = ? AND active = 1 ORDER BY ord', docKey);
  return json({ doc: { ...camel(d), tags: safeArr(d.tags) }, versions: versions.map((v) => camel(v)), chunks: chunks.map((c) => camel(c)) });
};
