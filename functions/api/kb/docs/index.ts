// GET /api/kb/docs 文档列表；POST /api/kb/docs 新建/编辑 → 新 draft 版本
import type { Env } from '../../../_lib/env';
import { HttpError, camel, json, nowIso, readJson, uid } from '../../../_lib/http';
import { all, first, isCategory, nextVersion, run, safeArr } from '../../../_lib/db';
import { buildFrontMatter, parseFrontMatter } from '../../../../core/chunk';
import type { ProductRisk } from '../../../../core/types';

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const rows = await all<any>(env.DB, `SELECT d.*,
      (SELECT version FROM doc_versions v WHERE v.doc_key = d.doc_key AND v.status = 'published' ORDER BY version DESC LIMIT 1) AS current_version,
      (SELECT COUNT(*) FROM chunks c WHERE c.doc_key = d.doc_key AND c.active = 1) AS chunks,
      (SELECT MAX(COALESCE(published_at, created_at)) FROM doc_versions v WHERE v.doc_key = d.doc_key) AS updated_at,
      (SELECT COUNT(*) FROM doc_versions v WHERE v.doc_key = d.doc_key AND v.status = 'draft') AS draft_count,
      (SELECT MAX(version) FROM doc_versions v WHERE v.doc_key = d.doc_key) AS latest_version
    FROM documents d ORDER BY d.category, d.doc_key`);
  return json({ items: rows.map((r) => ({ ...camel(r), tags: safeArr(r.tags) })) });
};

const RISKS = ['R1', 'R2', 'R3', 'R4', 'R5'];
function slug(s: string) {
  const a = s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return a.length >= 3 ? a.slice(0, 48) : `doc-${Date.now().toString(36)}`;
}

type DocBody = { versionId?: unknown; docKey?: unknown; title?: unknown; category?: unknown; productRisk?: unknown; tags?: unknown; content?: unknown; changeNote?: unknown; gapId?: unknown; author?: unknown; source?: unknown; effectiveDate?: unknown };

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const b = await readJson<DocBody>(request);
  // 字段类型校验（拒绝对象/数组被 String() 强转成 "[object Object]"）
  for (const k of ['versionId', 'docKey', 'title', 'category', 'content', 'changeNote', 'gapId', 'author', 'source', 'effectiveDate'] as const) {
    if (b[k] !== undefined && b[k] !== null && typeof b[k] !== 'string') throw new HttpError(400, 'BAD_INPUT', `${k} 必须是字符串`);
  }
  if (b.productRisk !== undefined && b.productRisk !== null && typeof b.productRisk !== 'string') throw new HttpError(400, 'BAD_INPUT', 'productRisk 必须是 R1–R5 或 null');
  if (b.tags !== undefined && b.tags !== null && !(typeof b.tags === 'string' || (Array.isArray(b.tags) && b.tags.every((t) => typeof t === 'string')))) throw new HttpError(400, 'BAD_INPUT', 'tags 必须是字符串数组');
  const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
  const content = str(b.content) ?? '';
  const { meta: fm, body } = parseFrontMatter(content);
  let docKey = (str(b.docKey) ?? (typeof fm.doc_key === 'string' ? fm.doc_key : '')).trim();
  if (docKey && !/^[a-z0-9][a-z0-9-]{1,63}$/.test(docKey)) throw new HttpError(400, 'BAD_INPUT', 'docKey 只能包含小写字母、数字和连字符');
  // 编辑已有文档：未传的元数据继承当前发布版本（没有发布版本则取最新版本）的 front-matter
  const prev = docKey ? await first<{ content: string }>(env.DB, `SELECT content FROM doc_versions WHERE doc_key = ? ORDER BY CASE status WHEN 'published' THEN 0 ELSE 1 END, version DESC LIMIT 1`, docKey) : null;
  const pm = prev ? parseFrontMatter(prev.content).meta : {};
  const pick = <T,>(...vals: T[]) => vals.find((v) => v !== undefined && v !== null && v !== '');
  const title = String(pick(str(b.title), fm.title as string, pm.title as string) ?? '').trim();
  if (!title) throw new HttpError(400, 'BAD_INPUT', 'title 不能为空');
  if (!body.trim() || !/^##\s/m.test(body)) throw new HttpError(400, 'BAD_INPUT', 'content 至少包含一个 "## 小标题" 段落');
  const category = String(pick(str(b.category), fm.category as string, pm.category as string) ?? 'investor_edu');
  if (!isCategory(category)) throw new HttpError(400, 'BAD_INPUT', `category 无效：${category}`);
  const prRaw = 'productRisk' in b ? b.productRisk : pick(fm.product_risk, pm.product_risk);
  const pr = typeof prRaw === 'string' && prRaw ? prRaw : null;
  if (pr && !RISKS.includes(pr)) throw new HttpError(400, 'BAD_INPUT', `productRisk 无效：${pr}`);
  const tags = Array.isArray(b.tags) ? (b.tags as string[]) : typeof b.tags === 'string' ? b.tags.split(/[,，\s]+/).filter(Boolean)
    : Array.isArray(fm.tags) && fm.tags.length ? (fm.tags as string[]) : Array.isArray(pm.tags) ? (pm.tags as string[]).map(String) : [];
  if (!docKey) docKey = slug(title);
  const ts = nowIso();
  const exists = await first(env.DB, 'SELECT doc_key FROM documents WHERE doc_key = ?', docKey);
  if (!exists) await run(env.DB, 'INSERT INTO documents (doc_key, title, category, product_risk, tags, created_at) VALUES (?, ?, ?, ?, ?, ?)', docKey, title, category, pr, JSON.stringify(tags), ts);
  const full = buildFrontMatter({ doc_key: docKey, title, category, product_risk: (pr as ProductRisk) ?? null, tags,
    source: String(pick(str(b.source), fm.source as string, pm.source as string) ?? '运营后台编辑'),
    effective_date: String(pick(str(b.effectiveDate), fm.effective_date as string, pm.effective_date as string) ?? ts.slice(0, 10)) }) + body.replace(/^\n+/, '');
  let gapId = str(b.gapId) ?? null;
  if (!gapId) gapId = (await first<{ gap_id: string }>(env.DB, `SELECT gap_id FROM doc_versions WHERE doc_key = ? AND status = 'draft' AND gap_id IS NOT NULL ORDER BY version DESC LIMIT 1`, docKey))?.gap_id ?? null;
  // 原地更新草稿：versionId 指向同一文档的 draft → UPDATE，返回同一版本；指向非 draft 或其他文档 → 400
  const vid = str(b.versionId);
  if (vid) {
    const cur = await first<{ id: string; doc_key: string; status: string }>(env.DB, 'SELECT id, doc_key, status FROM doc_versions WHERE id = ?', vid);
    if (!cur) throw new HttpError(404, 'NOT_FOUND', `版本不存在：${vid}`);
    if (cur.doc_key !== docKey) throw new HttpError(400, 'BAD_INPUT', `versionId 属于 ${cur.doc_key}，与 docKey ${docKey} 不一致`);
    if (cur.status !== 'draft') throw new HttpError(400, 'NOT_DRAFT', `版本 ${vid} 状态为 ${cur.status}，只能原地更新草稿；修改已发布内容请新建草稿`);
    await run(env.DB, `UPDATE doc_versions SET content = ?, change_note = ?, author = ?, gap_id = COALESCE(?, gap_id), created_at = ? WHERE id = ? AND status = 'draft'`,
      full, (str(b.changeNote) ?? '').slice(0, 300), (str(b.author) ?? '运营').slice(0, 40), gapId, ts, vid);
    if (gapId) await run(env.DB, `UPDATE gaps SET status = CASE WHEN status = 'open' THEN 'drafting' ELSE status END, doc_key = ? WHERE id = ?`, docKey, gapId);
    const row0 = await first(env.DB, 'SELECT * FROM doc_versions WHERE id = ?', vid);
    return json({ ...camel(row0), version: camel(row0), updated: true });
  }
  const version = await nextVersion(env.DB, docKey);
  const id = `dv_${uid().slice(0, 8)}`;
  await run(env.DB, `INSERT INTO doc_versions (id, doc_key, version, content, change_note, author, status, gap_id, created_at) VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
    id, docKey, version, full, (str(b.changeNote) ?? '').slice(0, 300), (str(b.author) ?? '运营').slice(0, 40), gapId, ts);
  if (gapId) await run(env.DB, `UPDATE gaps SET status = CASE WHEN status = 'open' THEN 'drafting' ELSE status END, doc_key = ? WHERE id = ?`, docKey, gapId);
  const row = await first(env.DB, 'SELECT * FROM doc_versions WHERE id = ?', id);
  return json({ ...camel(row), version: camel(row) });
};
