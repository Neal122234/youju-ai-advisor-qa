// POST /api/gaps/:id {action:'ignore'|'draft'}；draft → 生成草稿文档版本（预填问题样例），返回 docVersionId
import type { Env } from '../../_lib/env';
import { HttpError, json, nowIso, readJson, uid } from '../../_lib/http';
import { first, nextVersion, run, safeArr } from '../../_lib/db';
import { buildFrontMatter } from '../../../core/chunk';

export const onRequestPost: PagesFunction<Env> = async ({ params, request, env }) => {
  const id = String(params.id);
  const b = await readJson<{ action?: string; docKey?: string }>(request);
  const gap = await first<any>(env.DB, 'SELECT * FROM gaps WHERE id = ?', id);
  if (!gap) throw new HttpError(404, 'NOT_FOUND', '缺口不存在');
  if (b.action === 'ignore') {
    await run(env.DB, `UPDATE gaps SET status = 'ignored' WHERE id = ?`, id);
    return json({ ok: true, id, status: 'ignored' });
  }
  if (b.action === 'reopen') {
    await run(env.DB, `UPDATE gaps SET status = 'open' WHERE id = ?`, id);
    return json({ ok: true, id, status: 'open' });
  }
  if (b.action !== 'draft') throw new HttpError(400, 'BAD_INPUT', "action 只能是 'ignore' 或 'draft'");
  const docKey = (b.docKey && /^[a-z0-9][a-z0-9-]{2,63}$/.test(b.docKey) ? b.docKey : null) ?? gap.doc_key ?? `gap-${id.replace(/^gap_/, '')}`;
  const ts = nowIso();
  const existing = await first<any>(env.DB, 'SELECT * FROM documents WHERE doc_key = ?', docKey);
  const qs = safeArr(gap.questions_json);
  const title = existing?.title ?? `待补充：${String(gap.sample_question).slice(0, 30)}`;
  if (!existing) {
    await run(env.DB, `INSERT INTO documents (doc_key, title, category, product_risk, tags, created_at) VALUES (?, ?, 'investor_edu', NULL, '[]', ?)`, docKey, title, ts);
  }
  let content: string;
  const pub = existing ? await first<any>(env.DB, `SELECT content FROM doc_versions WHERE doc_key = ? AND status = 'published' ORDER BY version DESC LIMIT 1`, docKey) : null;
  if (pub) {
    content = `${pub.content.trimEnd()}\n\n## 补充：${String(gap.sample_question).slice(0, 30)}\n（待运营依据公开规则补写；用户问法：${qs.slice(0, 5).join(' / ')}）\n`;
  } else {
    content = buildFrontMatter({ doc_key: docKey, title, category: existing?.category ?? 'investor_edu', product_risk: existing?.product_risk ?? null, tags: [], source: '待补充出处', effective_date: ts.slice(0, 10) })
      + `## 问题说明\n（待运营依据公开监管规则或示例证券业务规则补写答案；拿不准的写"以官方最新规则为准"。）\n\n## 用户常见问法\n${qs.slice(0, 8).map((q) => `- ${q}`).join('\n')}\n`;
  }
  const version = await nextVersion(env.DB, docKey);
  const vid = `dv_${uid().slice(0, 8)}`;
  await run(env.DB, `INSERT INTO doc_versions (id, doc_key, version, content, change_note, author, status, gap_id, created_at) VALUES (?, ?, ?, ?, ?, '运营', 'draft', ?, ?)`,
    vid, docKey, version, content, `由知识缺口 ${id} 生成草稿`, id, ts);
  await run(env.DB, `UPDATE gaps SET status = 'drafting', doc_key = ? WHERE id = ?`, docKey, id);
  return json({ ok: true, docVersionId: vid, docKey, version, content });
};
