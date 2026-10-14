// Workers AI 适配：LLM（主 qwen3，失败回退 gpt-oss 一次，整体 12s 预算）+ bge-m3 批量 embedding + x-fault 故障注入。
import type { LlmFn, LlmMessage } from '../../core/types';
import { stripThink } from '../../core/pipeline';
import type { AiBinding, Env, Fault } from './env';
import { mockAi } from './mockAi';

export const MODEL_MAIN = '@cf/qwen/qwen3-30b-a3b-fp8';
export const MODEL_FALLBACK = '@cf/openai/gpt-oss-120b';
export const MODEL_EMBED = '@cf/baai/bge-m3';
export const LLM_TIMEOUT_MS = 12_000;
export const EMBED_BATCH = 50;          // bge-m3 单次上限约 100 条，留余量
export const EMBED_TIMEOUT_MS = 15_000;

export class TimeoutError extends Error { constructor(label: string, ms: number) { super(`${label} 超时（${ms}ms）`); } }

export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let t: ReturnType<typeof setTimeout>;
  return Promise.race([p, new Promise<T>((_r, rej) => { t = setTimeout(() => rej(new TimeoutError(label, ms)), ms); })]).finally(() => clearTimeout(t));
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 兼容 Workers AI 各种返回形态：string / {response} / OpenAI choices / Responses API output[] */
export function extractText(result: unknown): string {
  if (result == null) return '';
  if (typeof result === 'string') return stripThink(result);
  const r = result as Record<string, any>;
  if (typeof r.response === 'string') return stripThink(r.response);
  if (r.response && typeof r.response === 'object') return stripThink(JSON.stringify(r.response));
  const c = r.choices?.[0];
  if (c) {
    const content = c.message?.content ?? c.text ?? c.delta?.content;
    if (typeof content === 'string') return stripThink(content);
    if (Array.isArray(content)) return stripThink(content.map((p: any) => p?.text ?? '').join(''));
  }
  if (typeof r.output_text === 'string') return stripThink(r.output_text);
  if (Array.isArray(r.output)) {
    const parts: string[] = [];
    for (const o of r.output) {
      if (o?.type === 'reasoning') continue;
      if (typeof o?.content === 'string') parts.push(o.content);
      else if (Array.isArray(o?.content)) for (const p of o.content) if (typeof p?.text === 'string') parts.push(p.text);
    }
    if (parts.length) return stripThink(parts.join(''));
  }
  if (typeof r.result === 'object') return extractText(r.result);
  return '';
}

async function callModel(ai: AiBinding, model: string, messages: LlmMessage[], maxTokens: number): Promise<string> {
  if (model === MODEL_FALLBACK) {
    // gpt-oss 走 Responses 风格入参
    const sys = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
    const rest = messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role, content: m.content }));
    const res = await ai.run(model, { instructions: sys, input: rest, reasoning: { effort: 'low' }, max_output_tokens: maxTokens });
    return extractText(res);
  }
  // qwen3：/no_think 关闭思考，降低延迟；仍兼容可能返回的 <think>
  const msgs = messages.map((m, i) => (i === messages.length - 1 && m.role === 'user' ? { ...m, content: `${m.content}\n/no_think` } : m));
  const res = await ai.run(model, { messages: msgs, max_tokens: maxTokens, temperature: 0 });
  return extractText(res);
}

/* ================= Provider：SiliconFlow（OpenAI 兼容）+ Workers AI ================= */
export type Provider = 'workers-ai' | 'siliconflow';
export const SF_BASE = 'https://api.siliconflow.cn/v1';
export const SF_DEFAULT_CHAT = 'Qwen/Qwen3-30B-A3B-Instruct-2507';
export const SF_DEFAULT_EMBED = 'BAAI/bge-m3';
/** 意图分类默认与生成同用 30B-A3B Instruct：评测中 8B 有越界漏判（"有没有翻倍基"）与闲聊误判；投机并行后分类时延被生成掩盖，用 30B 不增加总时延。可用 SF_INTENT_MODEL 覆盖 */
export const SF_DEFAULT_INTENT = SF_DEFAULT_CHAT;
/** 默认主备顺序：SiliconFlow 为主、Workers AI 为备（可用 env PROVIDER_ORDER 覆盖） */
export const DEFAULT_PROVIDER_ORDER: Provider[] = ['siliconflow', 'workers-ai'];
/** 额度/余额类错误后的熔断时长（本 isolate 内）：期间跳过该通道，不再先撞一次失败 */
export const QUOTA_BREAKER_MS = 30 * 60_000;

const state = { quotaUntil: { 'workers-ai': 0, siliconflow: 0 } as Record<Provider, number>, lastOk: { 'workers-ai': 0, siliconflow: 0 } as Record<Provider, number>, lastQuota: { 'workers-ai': 0, siliconflow: 0 } as Record<Provider, number>, sfTokens: 0 };
export function providerState() { return { quotaUntil: { ...state.quotaUntil }, lastOk: { ...state.lastOk }, lastQuota: { ...state.lastQuota }, sfTokens: state.sfTokens,
  /** 兼容旧字段 */ workersAiQuotaUntil: state.quotaUntil['workers-ai'] }; }
export function resetProviderState() { for (const p of ['workers-ai', 'siliconflow'] as Provider[]) { state.quotaUntil[p] = 0; state.lastOk[p] = 0; state.lastQuota[p] = 0; } state.sfTokens = 0; }
/** 额度/余额类错误：Workers AI 4006（每日免费额度）、SiliconFlow 402（余额不足）/ 429 配额等 */
export function isQuotaError(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e);
  return /\b4006\b|daily free allocation|neurons|quota exceeded|exceeded your (daily|monthly)|HTTP 402\b|insufficient (balance|quota)|余额不足|账户余额/i.test(m);
}
function trip(p: Provider, now = Date.now()) { state.quotaUntil[p] = now + QUOTA_BREAKER_MS; state.lastQuota[p] = now; }
const tripped = (p: Provider, now = Date.now()) => state.quotaUntil[p] > now;
const LABEL: Record<Provider, string> = { 'workers-ai': 'Workers AI', siliconflow: 'SiliconFlow' };

export function sfConfigured(env: Env): boolean { return typeof env.SILICONFLOW_API_KEY === 'string' && env.SILICONFLOW_API_KEY.length > 10; }
export function providerOrder(env: Env): Provider[] {
  const raw = (env.PROVIDER_ORDER ?? '').split(/[\s,]+/).map((x) => x.trim().toLowerCase()).filter((x): x is Provider => x === 'siliconflow' || x === 'workers-ai');
  const order = raw.length ? [...new Set(raw)] : DEFAULT_PROVIDER_ORDER;
  for (const p of DEFAULT_PROVIDER_ORDER) if (!order.includes(p)) order.push(p);
  return order;
}
const available = (env: Env, p: Provider) => (p === 'workers-ai' ? !!env.AI : sfConfigured(env));
export function parseProvider(req: Request): Provider | null {
  const v = (req.headers.get('x-provider') ?? '').trim().toLowerCase();
  return v === 'siliconflow' || v === 'workers-ai' ? v : null;
}
/** 本次请求要尝试的通道链：x-provider 强制时只用它；否则按主备顺序，跳过未配置与熔断中的（全部熔断时仍按原顺序尝试） */
function chain(env: Env, forced: Provider | null): { list: Provider[]; skipped: string[] } {
  if (forced) return { list: available(env, forced) ? [forced] : [], skipped: available(env, forced) ? [] : [`${LABEL[forced]} 未配置`] };
  const order = providerOrder(env).filter((p) => available(env, p));
  const live = order.filter((p) => !tripped(p));
  const skipped = order.filter((p) => tripped(p)).map((p) => `${LABEL[p]} 额度熔断中（至 ${new Date(state.quotaUntil[p]).toISOString().slice(11, 16)} UTC）`);
  return { list: live.length ? live : order, skipped: live.length ? skipped : [] };
}

async function sfFetch(env: Env, path: string, body: unknown, timeoutMs: number, label: string, outer?: AbortSignal): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  // 外部取消（投机生成被丢弃）时同时中止 HTTP 请求
  const onAbort = () => ctrl.abort();
  if (outer) { if (outer.aborted) ctrl.abort(); else outer.addEventListener('abort', onAbort, { once: true }); }
  try {
    const res = await fetch(`${SF_BASE}${path}`, {
      method: 'POST', signal: ctrl.signal,
      headers: { authorization: `Bearer ${env.SILICONFLOW_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`SiliconFlow ${label} HTTP ${res.status}：${text.slice(0, 160)}`);
    const j = JSON.parse(text);
    state.sfTokens += Number(j?.usage?.total_tokens ?? 0) || 0;
    return j;
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') { if (outer?.aborted) throw new Error(`SiliconFlow ${label} 已取消`); throw new TimeoutError(`SiliconFlow ${label}`, timeoutMs); }
    throw e;
  } finally { clearTimeout(t); outer?.removeEventListener('abort', onAbort); }
}

export interface LlmHandle { llm: LlmFn | null; modelName: (purpose?: 'intent' | 'generate') => string | null; calls: () => number; notes: () => string[] }

/**
 * 生成 LLM 函数，按通道链依次尝试（默认 SiliconFlow → Workers AI，env PROVIDER_ORDER 可改）。
 * - 额度/余额错误（Workers AI 4006、SiliconFlow 402 等）：该通道熔断 30 分钟，立即尝试下一个通道。
 * - 其他错误：Workers AI 内部先回退 gpt-oss；仍失败且剩余预算 ≥3s 时尝试下一个通道。
 * - forced（x-provider 头）只用指定通道。整体预算不超过 timeoutMs。
 */
export function createLlm(env: Env, faults: Set<Fault>, budgetMs = LLM_TIMEOUT_MS, forced: Provider | null = null): LlmHandle {
  let used: string | null = null; let calls = 0; const notes: string[] = [];
  const usedBy: Record<string, string> = {};
  if (!available(env, 'workers-ai') && !available(env, 'siliconflow')) return { llm: null, modelName: () => null, calls: () => 0, notes: () => [] };
  const llm: LlmFn = async (messages, o) => {
    const budget = o?.timeoutMs ?? budgetMs;
    const deadline = Date.now() + budget;
    const maxTokens = o?.maxTokens ?? 700;
    const left = () => deadline - Date.now();
    const guard = async <T,>(label: string, fn: () => Promise<T>) => {
      calls++;
      if (left() <= 0) throw new TimeoutError('LLM', budget);
      if (o?.signal?.aborted) throw new Error('已取消');
      if (faults.has('llm')) throw new Error(`故障注入：${label} 不可用`);
      if (faults.has('slow-llm')) await sleep(budget + 1000);
      return withTimeout(fn(), left(), `LLM(${label})`);
    };
    const viaWai = async (model: string) => {
      const ai = env.AI!;
      const text = await guard(model, () => callModel(ai, model, messages, maxTokens));
      if (!text.trim()) throw new Error(`${model} 返回空内容`);
      state.lastOk['workers-ai'] = Date.now();
      used = ai === mockAi ? `mock/${model}` : `workers-ai/${model}`;
      usedBy[o?.purpose ?? 'generate'] = used;
      return text;
    };
    const runWai = async () => {
      try { return await viaWai(MODEL_MAIN); }
      catch (e) {
        if (isQuotaError(e) || o?.noFallback || e instanceof TimeoutError || left() < Math.min(3000, budget * 0.6)) throw e;
        return viaWai(MODEL_FALLBACK);
      }
    };
    const runSf = async () => {
      const model = o?.purpose === 'intent' ? (env.SF_INTENT_MODEL || SF_DEFAULT_INTENT) : (env.SF_CHAT_MODEL || SF_DEFAULT_CHAT);
      const text = await guard(`siliconflow/${model}`, async () => {
        const r = await sfFetch(env, '/chat/completions', { model, messages, max_tokens: maxTokens, temperature: 0, stream: false, enable_thinking: false }, Math.max(500, left()), 'chat', o?.signal);
        return extractText(r);
      });
      if (!text.trim()) throw new Error(`siliconflow/${model} 返回空内容`);
      state.lastOk.siliconflow = Date.now();
      used = `siliconflow/${model}`;
      usedBy[o?.purpose ?? 'generate'] = used;
      return text;
    };
    const { list, skipped } = chain(env, forced);
    notes.push(...skipped);
    if (forced) notes.push(`x-provider 指定 ${LABEL[forced]}`);
    if (!list.length) throw new Error(skipped[0] ?? '没有可用的模型通道');
    let lastErr: unknown = null;
    for (let k = 0; k < list.length; k++) {
      const p = list[k];
      try { return await (p === 'workers-ai' ? runWai() : runSf()); }
      catch (e) {
        lastErr = e;
        const quota = isQuotaError(e);
        if (quota) trip(p);
        console.warn(`[llm] ${p} failed`, e instanceof Error ? e.message.slice(0, 120) : String(e));
        const next = list[k + 1];
        if (!next) break;
        if (faults.has('llm') || e instanceof TimeoutError || o?.signal?.aborted) break;
        if (left() < (quota ? 1000 : 3000)) break;
        const code = (e instanceof Error ? e.message : String(e)).match(/\b(4006|402|429|5\d\d)\b/)?.[1];
        notes.push(`${LABEL[p]}${quota ? ' 额度/余额不足' : ' 调用失败'}${code ? `（${code}）` : ''} → 切换 ${LABEL[next]}`);
      }
    }
    throw lastErr;
  };
  return { llm, modelName: (purpose) => (purpose ? usedBy[purpose] ?? null : used), calls: () => calls, notes: () => [...notes] };
}

export interface EmbedResult { vectors: number[][]; provider: string; note: string | null }

/** 批量 embedding（每批 ≤50 条），通道链同 LLM（两者都是 bge-m3，向量可混用）。 */
export async function embedTextsDetailed(env: Env, texts: string[], faults: Set<Fault> = new Set(), forced: Provider | null = null): Promise<EmbedResult> {
  if (faults.has('embed')) throw new Error('故障注入：embedding 服务不可用');
  const viaWai = async () => {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += EMBED_BATCH) {
      const batch = texts.slice(i, i + EMBED_BATCH).map((t) => t.slice(0, 2000));
      const res = (await withTimeout(env.AI!.run(MODEL_EMBED, { text: batch }), EMBED_TIMEOUT_MS, 'embedding')) as { data?: number[][] };
      if (!Array.isArray(res?.data) || res.data.length !== batch.length) throw new Error('embedding 返回格式异常');
      out.push(...res.data);
    }
    state.lastOk['workers-ai'] = Date.now();
    return out;
  };
  const viaSf = async () => {
    const model = env.SF_EMBED_MODEL || SF_DEFAULT_EMBED;
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += EMBED_BATCH) {
      const batch = texts.slice(i, i + EMBED_BATCH).map((t) => t.slice(0, 2000));
      const r = await sfFetch(env, '/embeddings', { model, input: batch, encoding_format: 'float' }, EMBED_TIMEOUT_MS, 'embeddings');
      const data = (r?.data ?? []).slice().sort((a: any, b: any) => (a.index ?? 0) - (b.index ?? 0)).map((d: any) => d.embedding as number[]);
      if (data.length !== batch.length || !data.every((v: unknown) => Array.isArray(v))) throw new Error('SiliconFlow embeddings 返回格式异常');
      out.push(...data);
    }
    state.lastOk.siliconflow = Date.now();
    return out;
  };
  const { list, skipped } = chain(env, forced);
  if (!list.length) throw new Error(skipped[0] ?? 'AI binding 未配置');
  const notes: string[] = [...skipped];
  if (forced) notes.push(`x-provider 指定 ${LABEL[forced]}`);
  let lastErr: unknown = null;
  for (let k = 0; k < list.length; k++) {
    const p = list[k];
    try { const vectors = await (p === 'workers-ai' ? viaWai() : viaSf()); return { vectors, provider: p, note: notes.length ? notes.join('；') : null }; }
    catch (e) {
      lastErr = e;
      const quota = isQuotaError(e);
      if (quota) trip(p);
      if (list[k + 1]) notes.push(`${LABEL[p]}${quota ? ' 额度/余额不足（如 4006/402）' : ' embedding 失败'} → 切换 ${LABEL[list[k + 1]]}`);
    }
  }
  throw lastErr;
}
export async function embedTexts(env: Env, texts: string[], faults: Set<Fault> = new Set(), forced: Provider | null = null): Promise<number[][]> {
  return (await embedTextsDetailed(env, texts, faults, forced)).vectors;
}
/** 是否有任一可用的 embedding 通道 */
export const canEmbed = (env: Env) => !!env.AI || sfConfigured(env);

/** 存库用：保留 5 位小数，压缩 JSON 体积 */
export const packEmbedding = (v: number[]) => JSON.stringify(v.map((x) => Math.round(x * 1e5) / 1e5));
