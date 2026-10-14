// POST /api/kb/unpublish {docKey, note?} → 下线文档：当前发布版本 archived、该文档块全部失效，生成新 release（不含该文档）
import type { Env } from '../../_lib/env';
import { HttpError, camel, json, nowIso, readJson, uid } from '../../_lib/http';
import { first, invalidateKbCache } from '../../_lib/db';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const b = await readJson<{ docKey?: unknown; note?: unknown; by?: unknown }>(request);
  if (typeof b.docKey !== 'string' || !b.docKey) throw new HttpError(400, 'BAD_INPUT', '需要 docKey(string)');
  if (b.note !== undefined && typeof b.note !== 'string') throw new HttpError(400, 'BAD_INPUT', 'note 必须是字符串');
  const db = env.DB;
  const pub = await first<{ id: string; version: number }>(db, `SELECT id, version FROM doc_versions WHERE doc_key = ? AND status = 'published'`, b.docKey);
  if (!pub) throw new HttpError(409, 'NOT_PUBLISHED', `${b.docKey} 当前没有已发布版本，无需下线`);
  const r = await first<{ seq: number }>(db, 'SELECT MAX(seq) AS seq FROM releases');
  const seq = (r?.seq ?? 0) + 1; const no = `v${seq}`; const relId = `rel_${no}_${uid().slice(0, 6)}`; const ts = nowIso();
  await db.batch([
    db.prepare(`UPDATE doc_versions SET status = 'archived' WHERE id = ?`).bind(pub.id),
    db.prepare('UPDATE chunks SET active = 0 WHERE doc_key = ?').bind(b.docKey),
    db.prepare(`INSERT INTO releases (id, release_no, seq, note, doc_versions_json, created_at, created_by)
      VALUES (?, ?, ?, ?, (SELECT COALESCE(json_group_array(id), '[]') FROM doc_versions WHERE status = 'published'), ?, ?)`)
      .bind(relId, no, seq, (b.note as string) || `下线 ${b.docKey}（v${pub.version}）`, ts, typeof b.by === 'string' ? b.by.slice(0, 40) : '运营'),
  ]);
  invalidateKbCache();
  const rel = await first(db, 'SELECT * FROM releases WHERE id = ?', relId);
  return json({ ...camel(rel), release: camel(rel), docKey: b.docKey, unpublishedVersion: pub.version });
};
