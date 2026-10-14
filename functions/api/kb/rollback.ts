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
  // 只能回滚到曾经发布过的版本（published/archived 且有 published_at）；草稿未经审核，不允许借回滚上线
  if (old.status === 'draft' || !old.published_at) throw new HttpError(400, 'NOT_PUBLISHED_VERSION', `${b.docKey} v${old.version} 从未发布过（状态 ${old.status}），不能作为回滚目标；如需上线请走发布流程`);
  const cur = await first<any>(env.DB, `SELECT version FROM doc_versions WHERE doc_key = ? AND status = 'published'`, b.docKey);
  if (cur && cur.version === old.version) throw new HttpError(409, 'ALREADY_CURRENT', `v${old.version} 已是当前发布版本`);
  const version = await nextVersion(env.DB, b.docKey);
  const id = `dv_${uid().slice(0, 8)}`;
  await run(env.DB, `INSERT INTO doc_versions (id, doc_key, version, content, change_note, author, status, created_at) VALUES (?, ?, ?, ?, ?, '运营', 'draft', ?)`,
    id, b.docKey, version, old.content, `回滚至 v${old.version}`, nowIso());
  const r = await publishVersions(env, env.DB, [id], b.note || `回滚 ${b.docKey} 至 v${old.version}（新版本 v${version}）`, '运营', parseFaults(request));
  return json({ ...camel(r.release), release: camel(r.release), versionId: id, version, rolledBackTo: old.version });
};
