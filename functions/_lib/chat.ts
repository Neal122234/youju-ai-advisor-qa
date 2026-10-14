// chat 编排（Worker 侧）：加载知识块 → 组装 adapters → runPipeline → 结果缓存 → 落库。chat / eval / gap verify 共用。
import type { ChatRequest, ChatResponse } from '../../core/types';
import { runPipeline, sanitizeInput } from '../../core/pipeline';
import { createHybridRetriever, createKeywordRetriever } from '../../core/retrieve';
import { normalizeQuestion } from '../../core/gaps';
import type { Env, Fault } from './env';
import { createLlm, embedTexts } from './ai';
import { dbFor, loadKb, persistChat, type KbState } from './db';
import { uid } from './http';

const edgeCache = () => (globalThis.caches as unknown as { default: Cache }).default;
/** 管线逻辑版本：改动判定/提示词时递增，避免命中旧逻辑的缓存结果 */
export const PIPELINE_VERSION = 'p12';
export const CACHE_TTL_MS = 10 * 60_000;
const memCache = new Map<string, { at: number; resp: ChatResponse }>();
export function clearChatCache() { memCache.clear(); }

async function sha(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

async function cacheGet(key: string): Promise<ChatResponse | null> {
  const m = memCache.get(key);
  if (m && Date.now() - m.at < CACHE_TTL_MS) return structuredClone(m.resp);
  try {
    const hit = await edgeCache().match(`https://youju-cache.internal/chat/${key}`);
    if (hit) return (await hit.json()) as ChatResponse;
  } catch { /* Cache API 不可用时忽略 */ }
  return null;
}
async function cachePut(key: string, resp: ChatResponse) {
  memCache.set(key, { at: Date.now(), resp: structuredClone(resp) });
  if (memCache.size > 500) { const oldest = memCache.keys().next().value; if (oldest) memCache.delete(oldest); }
  try {
    await edgeCache().put(`https://youju-cache.internal/chat/${key}`, new Response(JSON.stringify(resp), { headers: { 'content-type': 'application/json', 'cache-control': `max-age=${CACHE_TTL_MS / 1000}` } }));
  } catch { /* ignore */ }
}

export interface AnswerOptions {
  persist?: boolean;                       // 默认 true
  sessionTag?: string;                     // 覆盖 session_id（如 eval）
  useCache?: boolean;                      // 默认 true
  noLlm?: boolean;                         // 评测快速模式
  embedCache?: Map<string, number[]>;      // 预计算的查询向量
  kb?: KbState;
}

export async function answer(env: Env, req: ChatRequest, faults: Set<Fault>, o: AnswerOptions = {}): Promise<ChatResponse> {
  const db = dbFor(env, faults);
  const kb = o.kb ?? (await loadKb(db));
  const embedNote: string[] = [];
  const handle = o.noLlm ? { llm: null, modelName: () => null, calls: () => 0 } : createLlm(env, faults);

  const canVector = kb.source === 'd1' && kb.embedded > 0 && !!env.AI;
  const retrieve = canVector
    ? createHybridRetriever(kb.chunks, async (q) => {
      const hit = o.embedCache?.get(q); if (hit) return hit;
      const [v] = await embedTexts(env, [q], faults);
      return v;
    }, { onEmbedError: (e) => embedNote.push(e instanceof Error ? e.message : String(e)) })
    : createKeywordRetriever(kb.chunks);

  const sanitized = sanitizeInput(req.question).text;
  const useCache = o.useCache !== false && faults.size === 0 && !(req.history?.length) && !o.noLlm;
  const cacheKey = useCache ? await sha(`${PIPELINE_VERSION}|${kb.release}|${req.userRisk}|${normalizeQuestion(sanitized)}`) : '';
  let resp: ChatResponse | null = null;
  if (useCache && sanitized) {
    const c = await cacheGet(cacheKey);
    if (c) {
      resp = { ...c, id: uid(), latencyMs: 0, checks: [...c.checks.filter((x) => x.name !== 'persistence' && x.name !== 'cache'), { name: 'cache', pass: true, detail: '命中 10 分钟结果缓存（同问题 + 同 release + 同风险等级），未重复调用 LLM' }] };
      if (resp.handoff?.ticketId) resp.handoff = { ...resp.handoff, ticketId: `TK${uid().replace(/-/g, '').slice(0, 10).toUpperCase()}` };
    }
  }
  if (!resp) {
    resp = await runPipeline(req, {
      retrieve, llm: handle.llm, kbRelease: kb.release, newId: uid, modelName: handle.modelName,
      scripts: () => kb.chunks.filter((c) => c.category === 'compliance_script'),
    });
    if (kb.note) resp.checks.splice(2, 0, { name: 'kb_source', pass: kb.source === 'd1', detail: kb.note });
    if (embedNote.length) {
      const r = resp.checks.find((c) => c.name === 'retrieval');
      if (r) { r.pass = false; r.detail += `（embedding 失败：${embedNote[0]}）`; }
    }
    // 仅缓存真正调用了 LLM 且非转人工的结果（转人工每次要生成新工单）
    if (useCache && resp.mode === 'llm' && resp.model && !resp.decision.startsWith('handoff')) await cachePut(cacheKey, resp);
  }
  if (o.persist !== false) await persistChat(db, req, resp, o.sessionTag);
  return resp;
}
