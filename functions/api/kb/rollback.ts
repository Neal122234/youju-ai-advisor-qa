// POST /api/kb/rollback {docKey, version} → 以历史版本内容新建版本并重新发布（新 release）
import type { Env } from '../../_lib/env';
import { parseFaults } from '../../_lib/env';
import { HttpError, camel, json, nowIso, readJson, uid } from '../../_lib/http';
import { first, nextVersion, publishVersions, run } from '../../_lib/db';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const b = await readJson<{ docKey?: string; version?: number; note?: string }>(request);
  if (!b.docKey || !Number.isFinite(Number(b.version))) throw new HttpError(400, 'BAD_INPUT', '需要 docKey 与 version');
  const old = await first<any>(env.DB, 'SELECT * FROM doc_versions WHERE doc_key = ? AND version = ?', b.docKey, Number(b.version));
  if (!old) throw new HttpError(404, 'NOT_FOUND', `${b.docKey} v${b.version} 不存在`);
  const cur = await first<any>(env.DB, `SELECT version FROM doc_versions WHERE doc_key = ? AND status = 'published'`, b.docKey);
  if (cur && cur.version === old.version) throw new HttpError(409, 'ALREADY_CURRENT', `v${old.version} 已是当前发布版本`);
  const version = await nextVersion(env.DB, b.docKey);
  const id = `dv_${uid().slice(0, 8)}`;
  await run(env.DB, `INSERT INTO doc_versions (id, doc_key, version, content, change_note, author, status, created_at) VALUES (?, ?, ?, ?, ?, '运营', 'draft', ?)`,
    id, b.docKey, version, old.content, `回滚至 v${old.version}`, nowIso());
  const r = await publishVersions(env, env.DB, [id], b.note || `回滚 ${b.docKey} 至 v${old.version}（新版本 v${version}）`, '运营', parseFaults(request));
  return json({ ...camel(r.release), release: camel(r.release), versionId: id, version, rolledBackTo: old.version });
};
