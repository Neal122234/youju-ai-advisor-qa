// D1 适配：故障注入、知识块加载与缓存（失败回退内置 kb-bundle）、问答落库（日志/告警/缺口/工单）、发布。
import type { ChatRequest, ChatResponse, Chunk, ProductRisk } from '../../core/types';
import { chunkDocument, normalizeMeta, parseFrontMatter } from '../../core/chunk';
import { findMergeTarget, normalizeQuestion } from '../../core/gaps';
import { maskPII } from '../../core/compliance';
import bundle from '../../web/src/generated/kb-bundle.json';
import type { Env, Fault } from './env';
import { embedTexts, packEmbedding } from './ai';
import { HttpError, nowIso, uid } from './http';

export interface BundleDoc { docKey: string; title: string; category: string; productRisk: ProductRisk | null; tags: string[]; version: number; content: string }
export const BUNDLE = bundle as unknown as { release: string; docs: BundleDoc[]; chunks: Chunk[] };

/** x-fault: db → 所有 D1 调用抛错 */
export function faultyDb(): D1Database {
  const boom = () => { throw new Error('故障注入：D1 不可用'); };
  const stmt: any = new Proxy({}, { get: (_t, k) => (k === 'bind' ? () => stmt : async () => boom()) });
  return new Proxy({} as D1Database, { get: (_t, k) => (k === 'prepare' ? () => stmt : async () => boom()) });
}
export function dbFor(env: Env, faults: Set<Fault>): D1Database { return faults.has('db') ? faultyDb() : env.DB; }

export async function all<T = Record<string, unknown>>(db: D1Database, sql: string, ...args: unknown[]): Promise<T[]> {
  const r = await db.prepare(sql).bind(...args).all<T>();
  return (r.results ?? []) as T[];
}
export async function first<T = Record<string, unknown>>(db: D1Database, sql: string, ...args: unknown[]): Promise<T | null> {
  return (await db.prepare(sql).bind(...args).first<T>()) ?? null;
}
export async function run(db: D1Database, sql: string, ...args: unknown[]) { return db.prepare(sql).bind(...args).run(); }

/* ---------------- 知识块加载 ---------------- */
export interface KbState { release: string; releaseId: string | null; chunks: Chunk[]; source: 'd1' | 'bundle'; embedded: number; note: string }
let cache: { key: string; state: KbState } | null = null;
export function invalidateKbCache() { cache = null; }

export async function currentRelease(db: D1Database): Promise<{ id: string; release_no: string; seq: number } | null> {
  return first(db, 'SELECT id, release_no, seq FROM releases ORDER BY seq DESC LIMIT 1');
}

export function bundleState(note: string): KbState {
  return { release: `${BUNDLE.release}-bundle`, releaseId: null, chunks: BUNDLE.chunks, source: 'bundle', embedded: 0, note };
}

/** 读取当前生效块（按 release 缓存在 isolate 内存，避免每次解析 embedding JSON）；D1 不可用/未初始化时回退内置 bundle（关键词模式） */
export async function loadKb(db: D1Database): Promise<KbState> {
  try {
    const rel = await currentRelease(db);
    if (!rel) return bundleState('D1 尚未初始化（未执行 /api/admin/seed），使用内置知识包');
    const cnt = await first<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM chunks WHERE active = 1');
    const key = `${rel.id}:${cnt?.n ?? 0}`;
    if (cache?.key === key) return cache.state;
    const rows = await all<any>(db, `SELECT c.id, c.doc_key, c.version, c.ord, c.heading, c.text, c.embedding, d.title, d.category, d.product_risk
      FROM chunks c JOIN documents d ON d.doc_key = c.doc_key WHERE c.active = 1 ORDER BY c.doc_key, c.ord`);
    let embedded = 0;
    const chunks: Chunk[] = rows.map((r) => {
      let emb: number[] | undefined;
      if (r.embedding) { try { emb = JSON.parse(r.embedding); embedded++; } catch { emb = undefined; } }
      return { id: r.id, docKey: r.doc_key, docTitle: r.title, version: r.version, ord: r.ord, heading: r.heading, text: r.text, category: r.category, productRisk: r.product_risk ?? null, embedding: emb };
    });
    const state: KbState = { release: rel.release_no, releaseId: rel.id, chunks, source: 'd1', embedded, note: embedded < chunks.length ? `${chunks.length - embedded} 块缺少向量，参与关键词检索` : '' };
    cache = { key, state };
    return state;
  } catch (e) {
    return bundleState(`D1 读取失败（${e instanceof Error ? e.message : e}），使用内置知识包`);
  }
}

/* ---------------- 落库 ---------------- */
export interface PersistResult { ok: boolean; errors: string[]; ticketId: string | null; gapId: string | null }

const GAP_GROUP: Record<string, string[]> = { unknown: ['unknown', 'low_conf'], low_conf: ['unknown', 'low_conf'], bad_feedback: ['bad_feedback', 'wrong_answer'], wrong_answer: ['bad_feedback', 'wrong_answer'] };

/** 新建或归并缺口：同组类型、未关闭的缺口中，归一化问题字二元组 Jaccard ≥ 0.5 → count+1 */
export async function upsertGap(db: D1Database, question: string, type: 'unknown' | 'low_conf' | 'bad_feedback' | 'wrong_answer'): Promise<string> {
  const q = maskPII(question, true);
  const group = GAP_GROUP[type];
  const rows = await all<any>(db, `SELECT id, norm_key, questions_json, count FROM gaps WHERE status IN ('open','drafting') AND type IN (${group.map(() => '?').join(',')}) ORDER BY last_seen DESC LIMIT 500`, ...group);
  const cands = rows.map((r) => ({ ...r, normKey: r.norm_key as string, questions: safeArr(r.questions_json) }));
  const target = findMergeTarget(q, cands);
  const ts = nowIso();
  if (target) {
    const qs = target.questions.includes(q) ? target.questions : [...target.questions, q].slice(-30);
    await run(db, 'UPDATE gaps SET count = count + 1, questions_json = ?, last_seen = ? WHERE id = ?', JSON.stringify(qs), ts, target.id);
    return target.id as string;
  }
  const id = `gap_${uid().slice(0, 8)}`;
  await run(db, `INSERT INTO gaps (id, norm_key, sample_question, questions_json, count, type, status, first_seen, last_seen) VALUES (?, ?, ?, ?, 1, ?, 'open', ?, ?)`,
    id, normalizeQuestion(q), q, JSON.stringify([q]), type, ts, ts);
  return id;
}
export function safeArr(s: unknown): string[] { try { const v = JSON.parse(String(s ?? '[]')); return Array.isArray(v) ? v.map(String) : []; } catch { return []; } }

/**
 * chat 之后落库：工单 → 告警 → 缺口 → qa_logs。每步独立 try/catch，任何失败都不影响 chat 返回。
 * 工单写入失败时把答案里的工单号替换为提示语，并回填 handoff.ticketId = null。
 */
export async function persistChat(db: D1Database, req: ChatRequest, resp: ChatResponse, sessionTag?: string): Promise<PersistResult> {
  const errors: string[] = []; let ticketId: string | null = resp.handoff?.ticketId ?? null; let gapId: string | null = null;
  const ts = nowIso();
  const question = maskPII(String(req.question ?? ''), true).slice(0, 500);
  const step = async (name: string, fn: () => Promise<unknown>) => { try { await fn(); } catch (e) { errors.push(`${name}: ${e instanceof Error ? e.message : e}`); } };

  if (resp.handoff?.ticketId) {
    await step('ticket', () => run(db, `INSERT INTO tickets (id, qa_id, reason, status, created_at, updated_at) VALUES (?, ?, ?, 'pending', ?, ?)`, resp.handoff!.ticketId, resp.id, resp.handoff!.reason, ts, ts));
    if (errors.length) {
      const old = resp.handoff.ticketId;
      resp.answer = resp.answer.split(old).join('暂未生成，请稍后重试或拨打客服热线');
      resp.handoff = { ...resp.handoff, ticketId: null }; ticketId = null;
    }
  }
  const alertHits = resp.compliance.filter((h) => h.category !== 'complaint_human');
  if (alertHits.length) {
    await step('alerts', () => db.batch(alertHits.map((h) => db.prepare(`INSERT INTO alerts (id, ts, qa_id, category, severity, stage, matched, question, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open')`)
      .bind(`al_${uid().slice(0, 8)}`, ts, resp.id, h.category, h.severity, h.stage, maskPII(h.matched, true), question))));
  }
  if (resp.decision === 'handoff_unknown' || resp.decision === 'handoff_low_conf') {
    await step('gap', async () => { gapId = await upsertGap(db, question, resp.decision === 'handoff_unknown' ? 'unknown' : 'low_conf'); });
  }
  resp.checks.push({ name: 'persistence', pass: errors.length === 0, detail: errors.length ? `落库部分失败（不影响作答）：${errors.join('；')}` : `已写入日志${resp.handoff?.ticketId ? '、工单' : ''}${alertHits.length ? `、告警×${alertHits.length}` : ''}${gapId ? '、缺口' : ''}` });
  await step('qa_log', () => run(db, `INSERT INTO qa_logs (id, ts, session_id, question, user_risk, decision, confidence, answer, response_json, kb_release, mode, latency_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    resp.id, ts, sessionTag ?? String(req.sessionId ?? '').slice(0, 64), question, resp.suitability?.userRisk ?? req.userRisk ?? 'C3', resp.decision, resp.confidence, resp.answer, JSON.stringify(resp), resp.kbRelease, resp.mode, resp.latencyMs));
  if (errors.length) { const c = resp.checks[resp.checks.length - 1]; c.pass = false; c.detail = `落库部分失败（不影响作答）：${errors.join('；')}`; }
  return { ok: errors.length === 0, errors, ticketId, gapId };
}

/* ---------------- 发布 ---------------- */
const CATEGORIES = ['product_rule', 'market_basics', 'investor_edu', 'compliance_script', 'suitability'];
export const isCategory = (c: string) => CATEGORIES.includes(c);

async function nextReleaseNo(db: D1Database): Promise<{ no: string; seq: number }> {
  const r = await first<{ seq: number }>(db, 'SELECT MAX(seq) AS seq FROM releases');
  const seq = (r?.seq ?? 0) + 1;
  return { no: `v${seq}`, seq };
}

/** 发布若干 doc_version：切分 → embedding（失败则整体不发布）→ 单个 D1 batch 原子切换 → 新 release */
export async function publishVersions(env: Env, db: D1Database, versionIds: string[], note: string, by = '运营', faults: Set<Fault> = new Set()) {
  if (!versionIds.length) throw new HttpError(400, 'BAD_INPUT', 'versionIds 不能为空');
  const versions = [];
  for (const id of versionIds) {
    const v = await first<any>(db, 'SELECT * FROM doc_versions WHERE id = ?', id);
    if (!v) throw new HttpError(404, 'NOT_FOUND', `版本不存在：${id}`);
    if (v.status === 'published') throw new HttpError(409, 'ALREADY_PUBLISHED', `版本已是发布状态：${v.doc_key} v${v.version}`);
    versions.push(v);
  }
  if (new Set(versions.map((v) => v.doc_key)).size !== versions.length) throw new HttpError(400, 'BAD_INPUT', '同一文档一次只能发布一个版本');
  const prepared = versions.map((v) => {
    const { meta: fm } = parseFrontMatter(v.content);
    const meta = normalizeMeta({ ...fm, doc_key: v.doc_key }, v.doc_key);
    const chunks = chunkDocument(v.content, { docKey: v.doc_key, title: meta.title, version: v.version, category: meta.category, productRisk: meta.product_risk });
    if (!chunks.length) throw new HttpError(400, 'EMPTY_DOC', `${v.doc_key} v${v.version} 切分后为空`);
    return { v, meta, chunks };
  });
  const allChunks = prepared.flatMap((p) => p.chunks);
  // 未绑定 AI（如本地无远程 AI）时允许"仅关键词"发布：块不带向量，检索按 BM25 参与；绑定了 AI 但调用失败则整体不发布
  let vecs: (number[] | null)[];
  if (!env.AI) vecs = allChunks.map(() => null);
  else {
    try { vecs = await embedTexts(env, allChunks.map((c) => `${c.docTitle}｜${c.heading}\n${c.text}`), faults); }
    catch (e) { throw new HttpError(502, 'EMBED_FAILED', `向量化失败，未发布（知识库保持原版本）：${e instanceof Error ? e.message : e}`); }
  }
  const ts = nowIso();
  const stmts: D1PreparedStatement[] = [];
  let k = 0;
  for (const p of prepared) {
    const { v, meta } = p;
    stmts.push(db.prepare(`INSERT INTO documents (doc_key, title, category, product_risk, tags, created_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(doc_key) DO UPDATE SET title = excluded.title, category = excluded.category, product_risk = excluded.product_risk, tags = excluded.tags`)
      .bind(v.doc_key, meta.title, meta.category, meta.product_risk, JSON.stringify(meta.tags), ts));
    stmts.push(db.prepare(`UPDATE doc_versions SET status = 'archived' WHERE doc_key = ? AND status = 'published'`).bind(v.doc_key));
    stmts.push(db.prepare('UPDATE chunks SET active = 0 WHERE doc_key = ?').bind(v.doc_key));
    for (const c of p.chunks) {
      stmts.push(db.prepare(`INSERT OR REPLACE INTO chunks (id, doc_key, doc_version_id, version, ord, heading, text, embedding, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`)
        .bind(c.id, v.doc_key, v.id, v.version, c.ord, c.heading, c.text, (() => { const e = vecs[k++]; return e ? packEmbedding(e) : null; })()));
    }
    stmts.push(db.prepare(`UPDATE doc_versions SET status = 'published', published_at = ? WHERE id = ?`).bind(ts, v.id));
    if (v.gap_id) stmts.push(db.prepare(`UPDATE gaps SET doc_key = ?, status = CASE WHEN status = 'open' THEN 'drafting' ELSE status END WHERE id = ?`).bind(v.doc_key, v.gap_id));
  }
  const { no, seq } = await nextReleaseNo(db);
  const relId = `rel_${no}_${uid().slice(0, 6)}`;
  stmts.push(db.prepare(`INSERT INTO releases (id, release_no, seq, note, doc_versions_json, created_at, created_by)
    VALUES (?, ?, ?, ?, (SELECT COALESCE(json_group_array(id), '[]') FROM doc_versions WHERE status = 'published'), ?, ?)`).bind(relId, no, seq, note || `发布 ${versions.map((v) => `${v.doc_key} v${v.version}`).join('、')}`, ts, by));
  await db.batch(stmts);
  invalidateKbCache();
  const rel = await first<any>(db, 'SELECT * FROM releases WHERE id = ?', relId);
  return { release: rel, chunks: allChunks.length, embedded: !!env.AI, published: versions.map((v) => ({ id: v.id, docKey: v.doc_key, version: v.version })) };
}

export async function nextVersion(db: D1Database, docKey: string): Promise<number> {
  const r = await first<{ v: number }>(db, 'SELECT MAX(version) AS v FROM doc_versions WHERE doc_key = ?', docKey);
  return (r?.v ?? 0) + 1;
}
