// 统一 API 客户端：启动时探测 /api/health（2.5s 超时），不可达 → 浏览器内本地演示模式。
// 线上接口行字段可能是 snake_case 或 camelCase，这里统一归一化，页面只用 apiTypes 里的形状。
import type {
  Alert, ChatRequest, ChatResponse, Dashboard, DocDetail, DocInput, DocVersion, EvalItem, EvalRun, Gap,
  GapDraftResult, GapVerifyResult, Health, KbDoc, LogDetail, LogItem, PreviewChunk, Release, Ticket, TicketStatus,
} from './apiTypes';

export interface ApiClient {
  health(): Promise<Health>;
  chat(req: ChatRequest): Promise<ChatResponse>;
  feedback(qaId: string, helpful: boolean, note?: string): Promise<void>;
  logs(p?: { decision?: string; q?: string; limit?: number }): Promise<LogItem[]>;
  log(id: string): Promise<LogDetail>;
  dashboard(): Promise<Dashboard>;
  gaps(status?: string): Promise<Gap[]>;
  gapAction(id: string, action: 'ignore' | 'draft'): Promise<GapDraftResult | null>;
  gapVerify(id: string): Promise<GapVerifyResult>;
  alerts(status?: string): Promise<Alert[]>;
  ackAlert(id: string): Promise<void>;
  tickets(): Promise<Ticket[]>;
  updateTicket(id: string, body: { status: TicketStatus; reply?: string }): Promise<void>;
  docs(): Promise<KbDoc[]>;
  doc(docKey: string): Promise<DocDetail>;
  saveDoc(input: DocInput): Promise<DocVersion>;
  publish(versionIds: string[], note: string): Promise<Release>;
  rollback(docKey: string, version: number): Promise<Release>;
  releases(): Promise<Release[]>;
  previewChunks(content: string): Promise<PreviewChunk[]>;
  /** 线上实现按 8 题一批调用 /api/eval/run（offset/limit），onProgress 回报进度与累计结果 */
  runEval(ids?: string[], onProgress?: (done: number, total: number, partial: EvalRun) => void): Promise<EvalRun>;
}

export class ApiError extends Error {
  constructor(public code: string, message: string, public status = 0) { super(message); }
}

/* ---------------- 归一化工具 ---------------- */
type AnyObj = Record<string, any>;
const snake = (k: string) => k.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());
function g(o: AnyObj | null | undefined, ...keys: string[]): any {
  if (!o) return undefined;
  for (const k of keys) {
    if (o[k] !== undefined && o[k] !== null) return o[k];
    const s = snake(k);
    if (o[s] !== undefined && o[s] !== null) return o[s];
  }
  return undefined;
}
const num = (v: any, d = 0) => (v === undefined || v === null || v === '' || Number.isNaN(Number(v)) ? d : Number(v));
const str = (v: any, d = '') => (v === undefined || v === null ? d : String(v));
function jsonish<T>(v: any, d: T): T {
  if (v === undefined || v === null || v === '') return d;
  if (typeof v === 'string') { try { return JSON.parse(v) as T; } catch { return d; } }
  return v as T;
}
function list(r: any, ...keys: string[]): any[] {
  if (Array.isArray(r)) return r;
  for (const k of [...keys, 'items', 'rows', 'data', 'results']) if (Array.isArray(r?.[k])) return r[k];
  return [];
}
const tsOf = (v: any) => {
  if (v === undefined || v === null || v === '') return '';
  if (typeof v === 'number') return new Date(v < 1e12 ? v * 1000 : v).toISOString();
  return String(v);
};

export const norm = {
  log(o: AnyObj): LogItem {
    return {
      id: str(g(o, 'id', 'qaId')), ts: tsOf(g(o, 'ts', 'createdAt')), sessionId: str(g(o, 'sessionId')),
      question: str(g(o, 'question')), userRisk: str(g(o, 'userRisk'), 'C3') as any,
      decision: str(g(o, 'decision')) as any, confidence: num(g(o, 'confidence')), answer: str(g(o, 'answer')),
      kbRelease: str(g(o, 'kbRelease')), mode: str(g(o, 'mode')), latencyMs: num(g(o, 'latencyMs')),
      feedback: g(o, 'feedback') === undefined ? null : num(g(o, 'feedback')), feedbackNote: g(o, 'feedbackNote') ?? null,
    };
  },
  logDetail(o: AnyObj): LogDetail {
    const base = o?.log ?? o;
    const resp = jsonish<ChatResponse | null>(g(o, 'response', 'responseJson') ?? g(base, 'response', 'responseJson'), null);
    return { ...norm.log(base), response: resp };
  },
  gap(o: AnyObj): Gap {
    const qs = jsonish<string[]>(g(o, 'questions', 'questionsJson'), []);
    return {
      id: str(g(o, 'id')), normKey: str(g(o, 'normKey')), sampleQuestion: str(g(o, 'sampleQuestion')),
      questions: qs.length ? qs : [str(g(o, 'sampleQuestion'))], count: num(g(o, 'count'), 1),
      type: str(g(o, 'type'), 'unknown') as any, status: str(g(o, 'status'), 'open') as any,
      docKey: g(o, 'docKey') ?? null, resolvedRelease: g(o, 'resolvedRelease') ?? null,
      firstSeen: tsOf(g(o, 'firstSeen')), lastSeen: tsOf(g(o, 'lastSeen')),
      draftVersionId: g(o, 'draftVersionId', 'docVersionId') ?? null,
    };
  },
  alert(o: AnyObj): Alert {
    return {
      id: str(g(o, 'id')), ts: tsOf(g(o, 'ts')), qaId: g(o, 'qaId') ?? null, category: str(g(o, 'category')),
      severity: str(g(o, 'severity'), 'medium') as any, stage: str(g(o, 'stage'), 'input') as any,
      matched: str(g(o, 'matched')), question: str(g(o, 'question')), status: str(g(o, 'status'), 'open') as any,
      handledBy: g(o, 'handledBy') ?? null, handledAt: g(o, 'handledAt') ? tsOf(g(o, 'handledAt')) : null,
    };
  },
  ticket(o: AnyObj): Ticket {
    return {
      id: str(g(o, 'id')), qaId: g(o, 'qaId') ?? null, reason: str(g(o, 'reason')), status: str(g(o, 'status'), 'pending') as any,
      assignee: g(o, 'assignee') ?? null, reply: g(o, 'reply') ?? null, createdAt: tsOf(g(o, 'createdAt')),
      updatedAt: tsOf(g(o, 'updatedAt', 'createdAt')), question: g(o, 'question') ?? null,
    };
  },
  doc(o: AnyObj): KbDoc {
    const tags = g(o, 'tags');
    return {
      docKey: str(g(o, 'docKey')), title: str(g(o, 'title')), category: str(g(o, 'category')),
      productRisk: g(o, 'productRisk') || null,
      tags: Array.isArray(tags) ? tags : typeof tags === 'string' ? jsonish<string[]>(tags, tags.split(/[,，\s]+/).filter(Boolean)) : [],
      currentVersion: g(o, 'currentVersion', 'publishedVersion', 'version') ?? null,
      chunks: num(g(o, 'chunks', 'chunkCount')), updatedAt: tsOf(g(o, 'updatedAt', 'lastModified', 'createdAt')),
      draftCount: num(g(o, 'draftCount', 'drafts')),
    };
  },
  version(o: AnyObj): DocVersion {
    return {
      id: str(g(o, 'id')), docKey: str(g(o, 'docKey')), version: num(g(o, 'version')), content: str(g(o, 'content')),
      changeNote: str(g(o, 'changeNote')), author: str(g(o, 'author'), '运营'), status: str(g(o, 'status'), 'draft') as any,
      gapId: g(o, 'gapId') ?? null, createdAt: tsOf(g(o, 'createdAt')), publishedAt: g(o, 'publishedAt') ? tsOf(g(o, 'publishedAt')) : null,
    };
  },
  release(o: AnyObj): Release {
    const dv = jsonish<any[]>(g(o, 'docVersions', 'docVersionsJson'), []);
    return {
      id: str(g(o, 'id')), releaseNo: str(g(o, 'releaseNo', 'release')), note: str(g(o, 'note')),
      docVersions: dv.map((x) => (typeof x === 'string' ? x : str(g(x, 'id') ?? `${g(x, 'docKey')}@v${g(x, 'version')}`))),
      createdAt: tsOf(g(o, 'createdAt')), createdBy: str(g(o, 'createdBy'), '运营'),
    };
  },
  dashboard(o: AnyObj): Dashboard {
    const distRaw = g(o, 'decisionDist', 'decisions', 'byDecision') ?? [];
    const dist = Array.isArray(distRaw)
      ? distRaw.map((x: AnyObj) => ({ decision: str(g(x, 'decision')) as any, count: num(g(x, 'count', 'n')) }))
      : Object.entries(distRaw).map(([decision, count]) => ({ decision: decision as any, count: num(count) }));
    const total = num(g(o, 'total', 'totalQa', 'qaCount'), dist.reduce((s, d) => s + d.count, 0));
    const cnt = (pred: (d: string) => boolean) => dist.filter((d) => pred(d.decision)).reduce((s, d) => s + d.count, 0);
    const handoff = cnt((d) => d.startsWith('handoff'));
    const pairs = (v: any, k: string) =>
      (Array.isArray(v) ? v : Object.entries(v ?? {}).map(([a, b]) => ({ [k]: a, count: b }))).map((x: AnyObj) => ({ [k]: str(g(x, k, 'sampleQuestion', 'key')), count: num(g(x, 'count', 'n')) }));
    const rate = (v: any, fb: number) => { const n = num(v, fb); return n > 1 ? n / 100 : n; };
    return {
      total,
      autoResolveRate: rate(g(o, 'autoResolveRate', 'resolvedRate'), total ? 1 - handoff / total : 0),
      handoffRate: rate(g(o, 'handoffRate'), total ? handoff / total : 0),
      blockedCount: num(g(o, 'blockedCount', 'refusedCount', 'alertCount', 'alerts'), cnt((d) => d === 'refused' || d === 'partial_refusal')),
      avgConfidence: num(g(o, 'avgConfidence')),
      openGaps: num(g(o, 'openGaps', 'gapCount', 'gaps')),
      openAlerts: num(g(o, 'openAlerts', 'alertsOpen')),
      decisionDist: dist,
      topUnanswered: pairs(g(o, 'topUnanswered'), 'question') as any,
      topViolations: pairs(g(o, 'topViolations', 'topCategories'), 'category') as any,
      daily: list(g(o, 'daily', 'last7Days', 'volume')).map((x: AnyObj) => ({ date: str(g(x, 'date', 'day')), count: num(g(x, 'count', 'n')) })),
      kbRelease: str(g(o, 'kbRelease', 'release')),
    };
  },
  evalRun(o: AnyObj): EvalRun {
    const results: EvalItem[] = list(o, 'results').map((r: AnyObj) => {
      const actual = g(r, 'actual') ?? {};
      return {
        id: str(g(r, 'id')), type: str(g(r, 'type')), question: str(g(r, 'question')), userRisk: str(g(r, 'userRisk'), 'C3') as any,
        expect: g(r, 'expect') ?? {},
        actual: {
          decision: g(actual, 'decision') ?? g(r, 'decision') ?? null,
          citedDocKeys: g(actual, 'citedDocKeys', 'citations') ?? [],
          alerts: g(actual, 'alerts', 'compliance') ?? [],
          answer: str(g(actual, 'answer') ?? g(r, 'answer')),
          confidence: num(g(actual, 'confidence') ?? g(r, 'confidence')),
        },
        qaId: g(r, 'qaId') ?? g(actual, 'id', 'qaId') ?? null,
        pass: !!g(r, 'pass', 'passed'), reasons: g(r, 'reasons', 'failures') ?? [],
      };
    });
    const passed = num(g(o, 'passed'), results.filter((r) => r.pass).length);
    const total = num(g(o, 'total'), results.length);
    const byTypeRaw = g(o, 'byType');
    let byType: EvalRun['byType'];
    if (Array.isArray(byTypeRaw)) byType = byTypeRaw.map((x: AnyObj) => ({ type: str(g(x, 'type')), total: num(g(x, 'total')), passed: num(g(x, 'passed')) }));
    else if (byTypeRaw && typeof byTypeRaw === 'object') byType = Object.entries(byTypeRaw).map(([type, v]: [string, any]) => ({ type, total: num(v?.total), passed: num(v?.passed) }));
    else {
      const m = new Map<string, { type: string; total: number; passed: number }>();
      for (const r of results) { const e = m.get(r.type) ?? { type: r.type, total: 0, passed: 0 }; e.total++; if (r.pass) e.passed++; m.set(r.type, e); }
      byType = [...m.values()];
    }
    return { total, passed, passRate: total ? passed / total : 0, kbRelease: str(g(o, 'kbRelease', 'release')), byType, results };
  },
};

/* ---------------- 远端实现 ---------------- */
const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '';

async function http<T = any>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), init?.timeoutMs ?? 30000);
  try {
    const res = await fetch(API_BASE + path, {
      ...init, signal: ctrl.signal,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    });
    const text = await res.text();
    let body: any = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = null; }
    if (!res.ok) {
      const e = body?.error;
      throw new ApiError(e?.code ?? `HTTP_${res.status}`, e?.message ?? `请求失败（${res.status}）`, res.status);
    }
    if (body === null && text) throw new ApiError('BAD_JSON', '接口返回的不是 JSON');
    return body as T;
  } catch (err: any) {
    if (err?.name === 'AbortError') throw new ApiError('TIMEOUT', '请求超时');
    if (err instanceof ApiError) throw err;
    throw new ApiError('NETWORK', '网络不可达：' + (err?.message ?? ''));
  } finally { clearTimeout(t); }
}
async function withRetry<T>(fn: () => Promise<T>, tries = 2): Promise<T> {
  for (let i = 0; ; i++) {
    try { return await fn(); }
    catch (e: any) {
      const retriable = e instanceof ApiError && (e.code === 'NETWORK' || e.code === 'BAD_JSON' || (e.status >= 500 && e.status !== 501));
      if (!retriable || i >= tries) throw e;
      await new Promise((r) => setTimeout(r, i === 0 ? 800 : 2000));
    }
  }
}
const post = (body: any, extra?: RequestInit) => ({ method: 'POST', body: JSON.stringify(body ?? {}), ...extra });
const qs = (p: Record<string, any>) => {
  const s = Object.entries(p).filter(([, v]) => v !== undefined && v !== '' && v !== null).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  return s ? '?' + s : '';
};

/** 故障注入（演示用）：值写入 sessionStorage `youju.fault`，chat 请求带 x-fault 头 */
export function getFault(): string {
  try { return sessionStorage.getItem('youju.fault') ?? ''; } catch { return ''; }
}
export function setFault(v: string) {
  try { v ? sessionStorage.setItem('youju.fault', v) : sessionStorage.removeItem('youju.fault'); } catch { /* ignore */ }
}

export const remoteApi: ApiClient = {
  async health() { const r = await http('/api/health', { timeoutMs: 2500 }); return { ok: !!r.ok, kbRelease: str(g(r, 'kbRelease')), chunks: num(r.chunks), ai: !!r.ai }; },
  chat: (req) => {
    const f = getFault();
    // 边缘偶发 52x / 网络抖动：最多重试 2 次（退避 0.8s、2s）；4xx 与超时不重试
    return withRetry(() => http('/api/chat', post(req, { headers: f ? { 'x-fault': f } : {}, timeoutMs: 45000 } as any)));
  },
  async feedback(qaId, helpful, note) { await http('/api/feedback', post({ qaId, helpful, note })); },
  async logs(p = {}) { return list(await http('/api/logs' + qs(p)), 'logs').map(norm.log); },
  async log(id) { return norm.logDetail(await http('/api/logs/' + encodeURIComponent(id))); },
  async dashboard() { return norm.dashboard(await http('/api/dashboard')); },
  async gaps(status) { return list(await http('/api/gaps' + qs({ status })), 'gaps').map(norm.gap); },
  async gapAction(id, action) {
    const r = await http('/api/gaps/' + encodeURIComponent(id), post({ action }));
    if (action !== 'draft') return null;
    return { docVersionId: str(g(r, 'docVersionId', 'versionId', 'id')), docKey: g(r, 'docKey') ?? null };
  },
  async gapVerify(id) {
    const r = await http('/api/gaps/' + encodeURIComponent(id) + '/verify', post({}));
    return {
      resolved: !!g(r, 'resolved'), release: str(g(r, 'release', 'resolvedRelease', 'kbRelease')),
      results: list(r, 'results').map((x: AnyObj) => ({ question: str(g(x, 'question')), decision: str(g(x, 'decision')) as any, confidence: num(g(x, 'confidence')), qaId: g(x, 'qaId', 'id') ?? null })),
    };
  },
  async alerts(status) { return list(await http('/api/alerts' + qs({ status })), 'alerts').map(norm.alert); },
  async ackAlert(id) { await http('/api/alerts/' + encodeURIComponent(id) + '/ack', post({})); },
  async tickets() { return list(await http('/api/tickets'), 'tickets').map(norm.ticket); },
  async updateTicket(id, body) { await http('/api/tickets/' + encodeURIComponent(id), post(body)); },
  async docs() { return list(await http('/api/kb/docs'), 'docs').map(norm.doc); },
  async doc(docKey) {
    const r = await http('/api/kb/docs/' + encodeURIComponent(docKey));
    const versions = list(r, 'versions').map(norm.version).sort((a, b) => b.version - a.version);
    const d = norm.doc(r.doc ?? r);
    if (!d.docKey) d.docKey = docKey;
    if (d.currentVersion === null) d.currentVersion = versions.find((v) => v.status === 'published')?.version ?? null;
    return { doc: d, versions };
  },
  async saveDoc(input) { const r = await http('/api/kb/docs', post(input)); return norm.version(r.version ?? r); },
  async publish(versionIds, note) { const r = await http('/api/kb/publish', post({ versionIds, note })); return norm.release(r.release ?? r); },
  async rollback(docKey, version) { const r = await http('/api/kb/rollback', post({ docKey, version })); return norm.release(r.release ?? r); },
  async releases() { return list(await http('/api/kb/releases'), 'releases').map(norm.release); },
  async previewChunks(content) {
    const r = await http('/api/kb/preview-chunks', post({ content }));
    return list(r, 'chunks').map((c: AnyObj, i: number) => ({ ord: num(g(c, 'ord'), i), heading: str(g(c, 'heading')), text: str(g(c, 'text')) }));
  },
  async runEval(ids, onProgress) {
    // 分批：线上单请求有子请求/CPU 限制，每批 8 题，失败的批次重试
    const BATCH = 8;
    const all: EvalItem[] = []; let kbRelease = ''; let total = ids?.length ?? 0; let offset: number | null = 0;
    while (offset !== null) {
      const body: Record<string, unknown> = { offset, limit: BATCH }; if (ids?.length) body.ids = ids;
      const raw: any = await withRetry(() => http('/api/eval/run', post(body, { timeoutMs: 180000 } as any)), 3);
      const part = norm.evalRun(raw);
      all.push(...part.results); kbRelease = part.kbRelease || kbRelease;
      total = num(raw.totalQuestions, 0) && !ids?.length ? num(raw.totalQuestions) : (ids?.length ?? all.length);
      offset = raw.nextOffset === null || raw.nextOffset === undefined ? null : num(raw.nextOffset);
      onProgress?.(all.length, total, norm.evalRun({ results: all, kbRelease }));
    }
    return norm.evalRun({ results: all, kbRelease });
  },
};

/* ---------------- 模式选择 ---------------- */
export type ApiMode = 'remote' | 'local';
let current: ApiClient = remoteApi;
let mode: ApiMode = 'remote';
let healthInfo: Health | null = null;

export async function initApi(): Promise<{ mode: ApiMode; health: Health | null }> {
  const forced = new URLSearchParams(location.search).get('mode');
  if (forced !== 'local') {
    try {
      healthInfo = await remoteApi.health();
      if (healthInfo.ok) { current = remoteApi; mode = 'remote'; return { mode, health: healthInfo }; }
    } catch { /* fall through */ }
  }
  const { localApi } = await import('./local/engine');
  current = localApi; mode = 'local';
  healthInfo = await localApi.health();
  return { mode, health: healthInfo };
}

export const getMode = () => mode;
export const getHealth = () => healthInfo;
/** 代理：页面统一 import { api }，模式切换后自动指向当前实现 */
export const api: ApiClient = new Proxy({} as ApiClient, {
  get: (_t, k: string) => (current as any)[k].bind(current),
});
