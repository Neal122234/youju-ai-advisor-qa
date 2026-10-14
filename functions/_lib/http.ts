// HTTP 工具：统一 JSON 响应、错误格式 {error:{code,message}}、请求体解析、限流。
export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type,x-fault,x-admin-token,x-no-cache',
  'access-control-max-age': '86400',
};
export function json(data: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...CORS_HEADERS, ...extra } });
}
export function errorJson(status: number, code: string, message: string, extra: Record<string, string> = {}): Response {
  return json({ error: { code, message } }, status, extra);
}
export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T> {
  const text = await req.text();
  if (!text.trim()) return {} as T;
  try { const v = JSON.parse(text); if (v && typeof v === 'object') return v as T; } catch { /* fallthrough */ }
  throw new HttpError(400, 'BAD_JSON', '请求体必须是 JSON 对象');
}
export function clientIp(req: Request): string {
  return req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
}
export function isLocalRequest(req: Request): boolean {
  const h = new URL(req.url).hostname;
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h.endsWith('.localhost');
}

/**
 * 固定窗口限流（isolate 内存 Map）。取舍：零 D1 写入、不受 x-fault: db 影响、延迟为 0；
 * 代价是各 isolate/数据中心独立计数，只能挡住单点刷量，不是全局精确限额（生产应换 Durable Object / Rate Limiting binding）。
 */
const buckets = new Map<string, { start: number; n: number }>();
export function rateLimit(key: string, limit: number, windowMs = 60_000, now = Date.now()): { ok: boolean; remaining: number; resetMs: number } {
  const b = buckets.get(key);
  if (!b || now - b.start >= windowMs) {
    buckets.set(key, { start: now, n: 1 });
    if (buckets.size > 5000) for (const [k, v] of buckets) if (now - v.start >= windowMs) buckets.delete(k);
    return { ok: true, remaining: limit - 1, resetMs: windowMs };
  }
  b.n++;
  return { ok: b.n <= limit, remaining: Math.max(0, limit - b.n), resetMs: windowMs - (now - b.start) };
}
export function resetRateLimits() { buckets.clear(); }

/** snake_case 行 → camelCase 对象 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function camel(row: unknown): Record<string, any> {
  const o: Record<string, unknown> = {};
  if (!row || typeof row !== 'object') return o;
  for (const [k, v] of Object.entries(row as Record<string, unknown>)) o[k.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase())] = v;
  return o;
}
export const nowIso = () => new Date().toISOString();
export const uid = () => crypto.randomUUID();

/**
 * 全局限流（D1）：key = `${scope}:${ip}:${分钟}`，INSERT … ON CONFLICT DO UPDATE n=n+1 RETURNING n，一条语句完成计数。
 * 取舍：跨 isolate / 数据中心一致（D1 单主库），代价是每次 chat 多一次 D1 写（约几毫秒）；
 * 相比 Cache API（各数据中心独立、非原子）更准确，相比 Durable Object 无需额外绑定。
 * D1 不可用（含 x-fault: db）时返回 null，由调用方放行（fail-open），不影响问答可用性。
 */
let rlTableReady = false;
export async function d1RateLimit(db: D1Database, scope: string, ip: string, limit: number, now = Date.now()): Promise<{ ok: boolean; remaining: number; resetMs: number } | null> {
  try {
    const minute = Math.floor(now / 60_000);
    if (!rlTableReady) {
      await db.prepare('CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0, expires_at INTEGER NOT NULL)').run();
      rlTableReady = true;
    }
    const row = await db.prepare('INSERT INTO rate_limits (key, n, expires_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET n = n + 1 RETURNING n')
      .bind(`${scope}:${ip}:${minute}`, (minute + 2) * 60).first<{ n: number }>();
    if (Math.random() < 0.02) await db.prepare('DELETE FROM rate_limits WHERE expires_at < ?').bind(Math.floor(now / 1000)).run();
    const n = row?.n ?? 1;
    return { ok: n <= limit, remaining: Math.max(0, limit - n), resetMs: (minute + 1) * 60_000 - now };
  } catch {
    return null;
  }
}
