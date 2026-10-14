// /api/* 统一中间件：CORS 预检、限流（chat 每 IP 每分钟 20 次，其余 120 次）、异常 → {error:{code,message}}
import type { Env } from '../_lib/env';
import { CORS_HEADERS, HttpError, clientIp, d1RateLimit, errorJson, rateLimit } from '../_lib/http';
import { InputError } from '../../core/types';
import { mockAi } from '../_lib/mockAi';

export const CHAT_LIMIT = 20;
export const API_LIMIT = 120;

export const onRequest: PagesFunction<Env> = async (ctx) => {
  const { request } = ctx;
  if (!ctx.env.AI && ctx.env.MOCK_AI === '1') ctx.env.AI = mockAi;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  const path = new URL(request.url).pathname;
  const ip = clientIp(request);
  const isChat = path === '/api/chat' && request.method === 'POST';
  // chat 走 D1 全局计数（失败则退回 isolate 内存计数，等价于放行）；其他接口用内存计数
  const rl = (isChat && ctx.env.DB ? await d1RateLimit(ctx.env.DB, 'chat', ip, CHAT_LIMIT) : null) ?? rateLimit(`${isChat ? 'chat' : 'api'}:${ip}`, isChat ? CHAT_LIMIT : API_LIMIT);
  if (!rl.ok) {
    return errorJson(429, 'RATE_LIMITED', isChat ? `提问太频繁：每分钟最多 ${CHAT_LIMIT} 次，请 ${Math.ceil(rl.resetMs / 1000)} 秒后再试` : '请求过于频繁，请稍后再试',
      { 'retry-after': String(Math.ceil(rl.resetMs / 1000)) });
  }
  try {
    const res = await ctx.next();
    if (res.status === 405 || (res.status === 404 && !(res.headers.get('content-type') ?? '').includes('json'))) {
      return errorJson(res.status === 405 ? 405 : 404, res.status === 405 ? 'METHOD_NOT_ALLOWED' : 'NOT_FOUND', res.status === 405 ? `不支持 ${request.method} ${path}` : `接口不存在：${path}`);
    }
    const h = new Headers(res.headers);
    for (const [k, v] of Object.entries(CORS_HEADERS)) h.set(k, v);
    h.set('x-ratelimit-remaining', String(rl.remaining));
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
  } catch (e) {
    if (e instanceof HttpError) return errorJson(e.status, e.code, e.message);
    if (e instanceof InputError) return errorJson(400, 'BAD_INPUT', e.message);
    console.error('api error', path, e);
    // 不把内部异常原文返回给客户端（只记日志）
    return errorJson(500, 'INTERNAL', '服务内部错误，请稍后重试');
  }
};
