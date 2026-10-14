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

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const b = await readJson<{ docKey?: string; title?: string; category?: string; productRisk?: string | null; tags?: string[] | string; content?: string; changeNote?: string; gapId?: string | null; author?: string; source?: string; effectiveDate?: string }>(request);
  const content = String(b.content ?? '');
  const { meta: fm, body } = parseFrontMatter(content);
  const title = String(b.title ?? fm.title ?? '').trim();
  if (!title) throw new HttpError(400, 'BAD_INPUT', 'title 不能为空');
  if (!body.trim() || !/^##\s/m.test(body)) throw new HttpError(400, 'BAD_INPUT', 'content 至少包含一个 "## 小标题" 段落');
  const category = String(b.category ?? fm.category ?? 'investor_edu');
  if (!isCategory(category)) throw new HttpError(400, 'BAD_INPUT', `category 无效：${category}`);
  const pr = b.productRisk ?? (fm.product_risk as string | null) ?? null;
  if (pr && !RISKS.includes(String(pr))) throw new HttpError(400, 'BAD_INPUT', `productRisk 无效：${pr}`);
  const tags = Array.isArray(b.tags) ? b.tags.map(String) : typeof b.tags === 'string' ? b.tags.split(/[,，\s]+/).filter(Boolean) : Array.isArray(fm.tags) ? (fm.tags as string[]) : [];
  let docKey = String(b.docKey ?? fm.doc_key ?? '').trim();
  if (docKey && !/^[a-z0-9][a-z0-9-]{1,63}$/.test(docKey)) throw new HttpError(400, 'BAD_INPUT', 'docKey 只能包含小写字母、数字和连字符');
  if (!docKey) docKey = slug(title);
  const ts = nowIso();
  const exists = await first(env.DB, 'SELECT doc_key FROM documents WHERE doc_key = ?', docKey);
  if (!exists) await run(env.DB, 'INSERT INTO documents (doc_key, title, category, product_risk, tags, created_at) VALUES (?, ?, ?, ?, ?, ?)', docKey, title, category, pr, JSON.stringify(tags), ts);
  const full = buildFrontMatter({ doc_key: docKey, title, category, product_risk: (pr as ProductRisk) ?? null, tags,
    source: String(b.source ?? fm.source ?? '运营后台编辑'), effective_date: String(b.effectiveDate ?? fm.effective_date ?? ts.slice(0, 10)) }) + body.replace(/^\n+/, '');
  let gapId = b.gapId ?? null;
  if (!gapId) gapId = (await first<{ gap_id: string }>(env.DB, `SELECT gap_id FROM doc_versions WHERE doc_key = ? AND status = 'draft' AND gap_id IS NOT NULL ORDER BY version DESC LIMIT 1`, docKey))?.gap_id ?? null;
  const version = await nextVersion(env.DB, docKey);
  const id = `dv_${uid().slice(0, 8)}`;
  await run(env.DB, `INSERT INTO doc_versions (id, doc_key, version, content, change_note, author, status, gap_id, created_at) VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
    id, docKey, version, full, String(b.changeNote ?? '').slice(0, 300), String(b.author ?? '运营').slice(0, 40), gapId, ts);
  if (gapId) await run(env.DB, `UPDATE gaps SET status = CASE WHEN status = 'open' THEN 'drafting' ELSE status END, doc_key = ? WHERE id = ?`, docKey, gapId);
  const row = await first(env.DB, 'SELECT * FROM doc_versions WHERE id = ?', id);
  return json({ ...camel(row), version: camel(row) });
};
