// POST /api/admin/seed[?batch=n][&reset=1]：用内置 kb-bundle 初始化 D1（幂等）
//  - 无 batch：一次性完成（本地 wrangler pages dev 推荐）
//  - batch=0..n：每次只向量化 50 块，线上免费计划按批调用，响应里给 nextBatch，直到 done=true
//  - reset=1：清空全部业务表后重建（仅管理员）
// 鉴权：设置了 env.ADMIN_TOKEN 时需 header x-admin-token 相同；未设置时仅允许 localhost。
import type { Env } from '../../_lib/env';
import { HttpError, isLocalRequest, json, nowIso } from '../../_lib/http';
import { BUNDLE, all, first, invalidateKbCache } from '../../_lib/db';
import { EMBED_BATCH, embedTexts, packEmbedding } from '../../_lib/ai';
import { SCHEMA_SQL } from '../../_generated/schema';
import precomputed from '../../_generated/embeddings.json';
import { chunkFingerprint, decodeF16Base64, type EmbeddingBundle } from '../../../core/f16';

let PRE = precomputed as unknown as EmbeddingBundle;
/** 测试用：替换预计算向量表 */
export function __setPrecomputed(b: EmbeddingBundle) { PRE = b; }

/** 从预计算向量里取出与当前块内容一致（指纹相同）的向量；没有或内容已变返回 null */
export function precomputedFor(id: string, heading: string, text: string, pre: EmbeddingBundle = PRE): number[] | null {
  const e = pre.chunks?.[id];
  if (!e || e.fp !== chunkFingerprint(heading, text)) return null;
  const v = decodeF16Base64(e.v);
  return v.length ? v : null;
}

/** 拆分 schema.sql 为单条语句（去注释） */
export function schemaStatements(sql: string): string[] {
  return sql.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n').split(';').map((x) => x.trim()).filter(Boolean);
}

const TABLES = ['chunks', 'doc_versions', 'documents', 'releases', 'qa_logs', 'alerts', 'gaps', 'tickets'];

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (env.ADMIN_TOKEN ? request.headers.get('x-admin-token') !== env.ADMIN_TOKEN : !isLocalRequest(request)) {
    throw new HttpError(403, 'FORBIDDEN', env.ADMIN_TOKEN ? 'x-admin-token 无效' : '未配置 ADMIN_TOKEN，仅允许本地调用');
  }
  const u = new URL(request.url);
  const db = env.DB;
  const batchParam = u.searchParams.get('batch');
  await db.batch(schemaStatements(SCHEMA_SQL).map((q) => db.prepare(q)));
  if (u.searchParams.get('reset') === '1') { await db.batch(TABLES.map((t) => db.prepare(`DELETE FROM ${t}`))); invalidateKbCache(); }

  // 1) 元数据（幂等：INSERT OR IGNORE）
  const ts = nowIso();
  const stmts: D1PreparedStatement[] = [];
  for (const d of BUNDLE.docs) {
    stmts.push(db.prepare('INSERT OR IGNORE INTO documents (doc_key, title, category, product_risk, tags, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(d.docKey, d.title, d.category, d.productRisk, JSON.stringify(d.tags ?? []), ts));
    stmts.push(db.prepare(`INSERT OR IGNORE INTO doc_versions (id, doc_key, version, content, change_note, author, status, created_at, published_at) VALUES (?, ?, 1, ?, '初始知识库导入', 'seed', 'published', ?, ?)`).bind(`${d.docKey}@v1`, d.docKey, d.content, ts, ts));
  }
  for (const c of BUNDLE.chunks) {
    stmts.push(db.prepare('INSERT OR IGNORE INTO chunks (id, doc_key, doc_version_id, version, ord, heading, text, embedding, active) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 1)').bind(c.id, c.docKey, `${c.docKey}@v1`, c.version, c.ord, c.heading, c.text));
  }
  stmts.push(db.prepare(`INSERT OR IGNORE INTO releases (id, release_no, seq, note, doc_versions_json, created_at, created_by) VALUES ('rel_v1', 'v1', 1, '初始知识库导入', ?, ?, 'seed')`).bind(JSON.stringify(BUNDLE.docs.map((d) => `${d.docKey}@v1`)), ts));
  for (let i = 0; i < stmts.length; i += 90) await db.batch(stmts.slice(i, i + 90));

  // 2) 向量化（只补 embedding IS NULL 的块）
  const pendingAll = await all<{ id: string; heading: string; text: string; title: string }>(db,
    'SELECT c.id, c.heading, c.text, d.title FROM chunks c JOIN documents d ON d.doc_key = c.doc_key WHERE c.embedding IS NULL AND c.active = 1 ORDER BY c.id');
  // 先用预计算向量（db/embeddings.v1.json，经 build:kb 打包）直接写库，不调用 AI；只有缺失或内容已变的块才调用 AI
  let fromBundle = 0;
  const needAi: typeof pendingAll = [];
  const preStmts: D1PreparedStatement[] = [];
  for (const c of pendingAll) {
    const v = precomputedFor(c.id, c.heading, c.text);
    if (v) { preStmts.push(db.prepare('UPDATE chunks SET embedding = ? WHERE id = ?').bind(packEmbedding(v), c.id)); fromBundle++; }
    else needAi.push(c);
  }
  for (let i = 0; i < preStmts.length; i += 50) await db.batch(preStmts.slice(i, i + 50));
  const work = !env.AI ? [] : batchParam !== null ? needAi.slice(0, EMBED_BATCH) : needAi;
  let embedded = 0; let embedError: string | null = null;
  for (let i = 0; i < work.length; i += EMBED_BATCH) {
    const part = work.slice(i, i + EMBED_BATCH);
    try {
      const vecs = await embedTexts(env, part.map((c) => `${c.title}｜${c.heading}\n${c.text}`));
      await db.batch(part.map((c, k) => db.prepare('UPDATE chunks SET embedding = ? WHERE id = ?').bind(packEmbedding(vecs[k]), c.id)));
      embedded += part.length;
    } catch (e) { embedError = e instanceof Error ? e.message : String(e); break; }
  }
  invalidateKbCache();
  const left = await first<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM chunks WHERE embedding IS NULL AND active = 1');
  const total = await first<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM chunks WHERE active = 1');
  const done = (left?.n ?? 0) === 0 || !env.AI;
  return json({
    ok: !embedError, release: 'v1', docs: BUNDLE.docs.length, chunks: total?.n ?? 0, embeddedNow: embedded + fromBundle, fromPrecomputed: fromBundle, fromAi: embedded, pending: left?.n ?? 0, done,
    nextBatch: done ? null : batchParam !== null ? Number(batchParam) + 1 : 0, embedError,
    note: env.AI ? undefined : '未绑定 AI：已导入文档与块，未向量化（检索走关键词模式）；绑定 AI 后再次调用即可补齐向量',
  }, embedError ? 502 : 200);
};
