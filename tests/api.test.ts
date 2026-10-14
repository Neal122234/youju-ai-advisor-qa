// Functions 集成测试：node:sqlite 模拟 D1 + 确定性 mock AI，直接调用 Pages Functions handler。
import { beforeAll, describe, expect, it } from 'vitest';
import { createFakeD1 } from './helpers/fakeD1';
import { mockAi } from '../functions/_lib/mockAi';
import type { Env } from '../functions/_lib/env';
import { resetRateLimits } from '../functions/_lib/http';
import { clearChatCache } from '../functions/_lib/chat';
import { invalidateKbCache } from '../functions/_lib/db';
import * as seed from '../functions/api/admin/seed';
import * as chat from '../functions/api/chat';
import * as health from '../functions/api/health';
import * as gaps from '../functions/api/gaps/index';
import * as gapAction from '../functions/api/gaps/[id]';
import * as gapVerify from '../functions/api/gaps/[id]/verify';
import * as tickets from '../functions/api/tickets/index';
import * as alerts from '../functions/api/alerts/index';
import * as logDetail from '../functions/api/logs/[id]';
import * as feedback from '../functions/api/feedback';
import * as docs from '../functions/api/kb/docs/index';
import * as doc from '../functions/api/kb/docs/[docKey]';
import * as publish from '../functions/api/kb/publish';
import * as rollback from '../functions/api/kb/rollback';
import * as dashboard from '../functions/api/dashboard';
import * as evalRun from '../functions/api/eval/run';
import * as mw from '../functions/api/_middleware';

const env: Env = { DB: createFakeD1(), AI: mockAi };
const call = async (h: any, method: string, path: string, body?: unknown, headers: Record<string, string> = {}, params: Record<string, string> = {}) => {
  const request = new Request(`http://localhost${path}`, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const res: Response = await h({ request, env, params, next: async () => new Response('x'), waitUntil() {}, data: {} });
  return { status: res.status, body: await res.json() as any };
};
const ask = (question: string, userRisk = 'C3', headers: Record<string, string> = {}) => call(chat.onRequestPost, 'POST', '/api/chat', { question, userRisk, sessionId: 's1' }, headers);

beforeAll(async () => {
  seed.__setPrecomputed({ model: '', dims: 0, format: 'f16-base64', exportedAt: '', source: 'none', chunks: {} });   // 用 mock AI 的向量，不混入真实预计算向量
  invalidateKbCache(); clearChatCache(); resetRateLimits();
  const r = await call(seed.onRequestPost, 'POST', '/api/admin/seed', {});
  expect(r.status).toBe(200);
});

describe('seed / health', () => {
  it('seed 幂等，全部块向量化', async () => {
    const r = await call(seed.onRequestPost, 'POST', '/api/admin/seed', {});
    expect(r.body).toMatchObject({ done: true, pending: 0, embeddedNow: 0 });
    const h = await call(health.onRequestGet, 'GET', '/api/health');
    expect(h.body).toMatchObject({ ok: true, kbRelease: 'v1', db: true });
    expect(h.body.embedded).toBe(h.body.chunks);
  });
  it('非本地且未配 ADMIN_TOKEN → 403', async () => {
    const request = new Request('https://example.pages.dev/api/admin/seed', { method: 'POST' });
    await expect(seed.onRequestPost({ request, env, params: {}, next: async () => new Response(), waitUntil() {}, data: {} } as any)).rejects.toMatchObject({ status: 403 });
  });
});

describe('chat 落库', () => {
  it('越界 → refused + 告警落库', async () => {
    const r = await ask('宁德时代还能上车吗？');
    expect(r.body.decision).toBe('refused');
    const a = await call(alerts.onRequestGet, 'GET', '/api/alerts?status=open');
    expect(a.body.items.some((x: any) => x.qaId === r.body.id && x.category === 'stock_pick')).toBe(true);
  });
  it('转人工 → 工单 id 与答案一致，工单带 question', async () => {
    const r = await ask('转人工');
    const t = await call(tickets.onRequestGet, 'GET', '/api/tickets');
    const row = t.body.items.find((x: any) => x.id === r.body.handoff.ticketId);
    expect(row).toMatchObject({ qaId: r.body.id, status: 'pending', question: '转人工' });
  });
  it('未知问题 → 缺口，相似问题归并 count+1', async () => {
    await ask('比特币挖矿收益怎么样？');
    await ask('比特币挖矿收益怎么样呢');
    const g = await call(gaps.onRequestGet, 'GET', '/api/gaps?status=open');
    const gap = g.body.items.find((x: any) => x.sampleQuestion.includes('比特币'));
    expect(gap?.count).toBe(2);
  });
  it('x-fault: db → chat 仍成功（内置知识包兜底），persistence 失败记 check', async () => {
    const r = await ask('科创板权限开通需要满足什么条件？', 'C4', { 'x-fault': 'db' });
    expect(r.status).toBe(200);
    expect(r.body.decision).toMatch(/answered|degraded/);
    expect(r.body.checks.find((c: any) => c.name === 'persistence').pass).toBe(false);
    const t = await ask('我要投诉', 'C3', { 'x-fault': 'db' });
    expect(t.body.handoff.ticketId).toBeNull();
    expect(t.body.answer).toContain('暂未生成');
  });
  it('x-fault: llm → degraded；x-fault: embed → keyword 模式', async () => {
    expect((await ask('创业板开户门槛是多少资产？', 'C4', { 'x-fault': 'llm' })).body.decision).toBe('degraded');
    const e = await ask('创业板开户门槛是多少资产？', 'C4', { 'x-fault': 'embed' });
    expect(e.body.checks.find((c: any) => c.name === 'retrieval').detail).toContain('keyword');
  });
  it('缓存：同问题第二次命中缓存，id 不同', async () => {
    const a = await ask('ETF和LOF有什么区别？');
    const b = await ask('ETF和LOF有什么区别？');
    expect(b.body.id).not.toBe(a.body.id);
    expect(b.body.checks.some((c: any) => c.name === 'cache')).toBe(true);
  });
  it('日志详情含 response（不重复返回 responseJson）；差评生成 bad_feedback 缺口', async () => {
    const a = await ask('ETF和LOF有什么区别？', 'C4');
    const d = await call(logDetail.onRequestGet, 'GET', `/api/logs/${a.body.id}`, undefined, {}, { id: a.body.id });
    expect(d.body.response.id).toBe(a.body.id);
    expect(d.body.responseJson).toBeUndefined();
    const f = await call(feedback.onRequestPost, 'POST', '/api/feedback', { qaId: a.body.id, helpful: false });
    expect(f.body.gapId).toBeTruthy();
  });
  it('参数错误 → 400 统一格式', async () => {
    await expect(call(chat.onRequestPost, 'POST', '/api/chat', { question: '' })).rejects.toMatchObject({ status: 400, code: 'BAD_INPUT' });
  });
});

describe('知识库发布闭环', () => {
  it('缺口 → 草稿 → 编辑 → 发布 → 验证 resolved', async () => {
    await ask('基金赎回之后多久能到账？');
    const g = (await call(gaps.onRequestGet, 'GET', '/api/gaps?status=open')).body.items.find((x: any) => x.sampleQuestion.includes('赎回'));
    expect(g).toBeTruthy();
    const draft = await call(gapAction.onRequestPost, 'POST', `/api/gaps/${g.id}`, { action: 'draft' }, {}, { id: g.id });
    expect(draft.body.docVersionId).toBeNull();   // N11：不预建占位版本
    expect(draft.body.content).toContain('用户常见问法');
    const saved = await call(docs.onRequestPost, 'POST', '/api/kb/docs', { docKey: draft.body.docKey, title: '基金赎回到账时间', category: 'product_rule', productRisk: null, tags: ['赎回'], gapId: g.id, changeNote: '补充',
      content: '## 基金赎回多久到账\n货币基金赎回一般 T+1 个交易日到账；股票基金、混合基金赎回一般 T+1 至 T+4 个交易日到账，以基金合同为准。' });
    expect(saved.body.gapId).toBe(g.id);
    const pub = await call(publish.onRequestPost, 'POST', '/api/kb/publish', { versionIds: [saved.body.id], note: '补缺口' });
    expect(pub.body.releaseNo).toBe('v2');
    const v = await call(gapVerify.onRequestPost, 'POST', `/api/gaps/${g.id}/verify`, {}, {}, { id: g.id });
    expect(v.body).toMatchObject({ resolved: true, resolved_release: 'v2' });
  });
  it('embedding 失败时发布整体回滚（release 不变）', async () => {
    const saved = await call(docs.onRequestPost, 'POST', '/api/kb/docs', { docKey: 'rule-fees', title: '费用', category: 'product_rule', productRisk: null, tags: [], content: '## 费用\n测试修改。', changeNote: 't' });
    await expect(call(publish.onRequestPost, 'POST', '/api/kb/publish', { versionIds: [saved.body.id] }, { 'x-fault': 'embed' })).rejects.toMatchObject({ status: 502 });
    expect((await call(health.onRequestGet, 'GET', '/api/health')).body.kbRelease).toBe('v2');
    const p = await call(publish.onRequestPost, 'POST', '/api/kb/publish', { versionIds: [saved.body.id] });
    expect(p.body.releaseNo).toBe('v3');
    const rb = await call(rollback.onRequestPost, 'POST', '/api/kb/rollback', { docKey: 'rule-fees', version: 1 });
    expect(rb.body).toMatchObject({ releaseNo: 'v4', rolledBackTo: 1 });
    const d = await call(doc.onRequestGet, 'GET', '/api/kb/docs/rule-fees', undefined, {}, { docKey: 'rule-fees' });
    expect(d.body.doc.currentVersion).toBe(rb.body.version);
    expect(d.body.chunks.every((c: any) => !c.text.includes('测试修改'))).toBe(true);
    expect(d.body.versions.filter((x: any) => x.status === 'published').length).toBe(1);
  });
});

describe('dashboard / eval / 限流', () => {
  it('dashboard 字段齐全', async () => {
    const d = await call(dashboard.onRequestGet, 'GET', '/api/dashboard');
    for (const k of ['total', 'decisionDist', 'avgConfidence', 'openGaps', 'openAlerts', 'refusedCount', 'topUnanswered', 'topViolations', 'daily', 'kbRelease']) expect(d.body).toHaveProperty(k);
    expect(d.body.daily.length).toBe(7);
  });
  it('eval/run 子集返回 summarize 结构，题目带 qaId', async () => {
    const r = await call(evalRun.onRequestPost, 'POST', '/api/eval/run', { ids: ['O01', 'H01', 'M06'] });
    expect(r.body.total).toBe(3);
    expect(r.body.results.every((x: any) => x.qaId)).toBe(true);
    expect(r.body.results.filter((x: any) => x.pass).length).toBe(3);
  });
  it('chat 每 IP 每分钟 20 次', async () => {
    resetRateLimits();
    const ctx = (ip: string) => ({ request: new Request('http://localhost/api/chat', { method: 'POST', headers: { 'cf-connecting-ip': ip } }), env, params: {}, next: async () => new Response('{}', { headers: { 'content-type': 'application/json' } }), waitUntil() {}, data: {} });
    const codes: number[] = [];
    for (let i = 0; i < 21; i++) codes.push((await mw.onRequest(ctx('1.2.3.4') as any)).status);
    expect(codes.slice(0, 20).every((c) => c === 200)).toBe(true);
    expect(codes[20]).toBe(429);
    expect((await mw.onRequest(ctx('5.6.7.8') as any)).status).toBe(200);
  });
});

describe('QA 第 1 轮：接口边界', () => {
  const catchAll = async (method: string, path: string) => {
    const mod = await import('../functions/api/[[path]]');
    const res: Response = await (mod.onRequest as any)({ request: new Request(`http://localhost${path}`, { method }), env, params: {} });
    return { status: res.status, body: await res.json() as any };
  };
  it('B9 方法不对 → 405', async () => {
    expect((await catchAll('GET', '/api/chat')).status).toBe(405);
    expect((await catchAll('DELETE', '/api/tickets/x')).status).toBe(405);
    expect((await catchAll('GET', '/api/nope')).status).toBe(404);
  });
  it('B11 已关闭工单不能直接改回 pending；reopen 可重开', async () => {
    const r = await ask('转人工');
    const id = r.body.handoff.ticketId;
    const tk = await import('../functions/api/tickets/[id]');
    await call(tk.onRequestPost, 'POST', `/api/tickets/${id}`, { status: 'closed', reply: 'ok' }, {}, { id });
    await expect(call(tk.onRequestPost, 'POST', `/api/tickets/${id}`, { status: 'pending' }, {}, { id })).rejects.toMatchObject({ status: 409 });
    const re = await call(tk.onRequestPost, 'POST', `/api/tickets/${id}`, { reopen: true }, {}, { id });
    expect(re.body.ticket.status).toBe('processing');
  });
  it('B12 重复 ack 不覆盖处理时间；B13 limit=-1 截断', async () => {
    const r = await ask('宁德时代还能上车吗？');
    const a = (await call(alerts.onRequestGet, 'GET', '/api/alerts?status=open')).body.items.find((x: any) => x.qaId === r.body.id);
    const ack = await import('../functions/api/alerts/[id]/ack');
    const a1 = await call(ack.onRequestPost, 'POST', `/api/alerts/${a.id}/ack`, { by: 'A' }, {}, { id: a.id });
    const a2 = await call(ack.onRequestPost, 'POST', `/api/alerts/${a.id}/ack`, { by: 'B' }, {}, { id: a.id });
    expect(a2.body.handledAt).toBe(a1.body.handledAt);
    expect(a2.body.handledBy).toBe('A');
    const l = await call(alerts.onRequestGet, 'GET', '/api/alerts?limit=-1');
    expect(l.body.items.length).toBeLessThanOrEqual(1);
  });
  it('B14 同一记录重复差评不重复计数', async () => {
    const a = await ask('ETF和LOF有什么区别？', 'C5');
    const f1 = await call(feedback.onRequestPost, 'POST', '/api/feedback', { qaId: a.body.id, helpful: false });
    const f2 = await call(feedback.onRequestPost, 'POST', '/api/feedback', { qaId: a.body.id, helpful: false });
    expect(f1.body.gapId).toBeTruthy();
    expect(f2.body.gapId).toBeNull();
  });
  it('B15 eval 参数校验', async () => {
    for (const body of [{ limit: 0 }, { limit: 'x' }, { ids: 'O07' }, { offset: -1 }]) {
      await expect(call(evalRun.onRequestPost, 'POST', '/api/eval/run', body)).rejects.toMatchObject({ status: 400 });
    }
  });
  it('B17 字段类型校验', async () => {
    await expect(call(docs.onRequestPost, 'POST', '/api/kb/docs', { title: { x: 1 }, content: ['## a'] })).rejects.toMatchObject({ status: 400 });
    const pc = await import('../functions/api/kb/preview-chunks');
    await expect(call(pc.onRequestPost, 'POST', '/api/kb/preview-chunks', { content: { toString: 1 } })).rejects.toMatchObject({ status: 400 });
    await expect(call(feedback.onRequestPost, 'POST', '/api/feedback', { qaId: { a: 1 }, helpful: true })).rejects.toMatchObject({ status: 400 });
  });
  it('B17 中间件 500 不外泄内部异常', async () => {
    const res = await mw.onRequest({ request: new Request('http://localhost/api/x'), env, params: {}, next: async () => { throw new Error('D1_TYPE_ERROR secret detail'); }, waitUntil() {}, data: {} } as any);
    const b = await res.json() as any;
    expect(res.status).toBe(500);
    expect(b.error.message).not.toContain('D1_TYPE_ERROR');
  });
  it('B18 编辑已有文档未传 tags/source 时继承发布版本', async () => {
    const r = await call(docs.onRequestPost, 'POST', '/api/kb/docs', { docKey: 'rule-trading-hours', content: '## 测试\n测试正文。', changeNote: 'qa' });
    expect(r.body.content).toMatch(/tags: \[.+\]/);
    expect(r.body.content).not.toContain('source: 运营后台编辑');
    expect(r.body.content).toMatch(/title: .*交易时间/);
  });
  it('B5 D1 全局限流：跨 isolate 计数（重置内存后仍累计）', async () => {
    const { d1RateLimit } = await import('../functions/_lib/http');
    const now = Date.UTC(2026, 9, 14, 12, 0, 30);
    const res: (boolean | undefined)[] = [];
    for (let i = 0; i < 21; i++) { resetRateLimits(); res.push((await d1RateLimit(env.DB, 'chat', '9.9.9.9', 20, now))?.ok); }
    expect(res.slice(0, 20).every(Boolean)).toBe(true);
    expect(res[20]).toBe(false);
    const { faultyDb } = await import('../functions/_lib/db');
    expect(await d1RateLimit(faultyDb(), 'chat', '9.9.9.9', 20, now)).toBeNull();   // D1 失败 → 放行
  });
});

describe('QA 第 2 轮：下线与回滚', () => {
  it('N8 rollback 拒绝草稿；unpublish 生成新 release 并让块失效', async () => {
    const d = await call(docs.onRequestPost, 'POST', '/api/kb/docs', { docKey: 'qa-unpub', title: '下线测试', category: 'investor_edu', content: '## 段\n下线测试正文内容。' });
    await expect(call(rollback.onRequestPost, 'POST', '/api/kb/rollback', { docKey: 'qa-unpub', version: 1 })).rejects.toMatchObject({ status: 400 });
    const p = await call(publish.onRequestPost, 'POST', '/api/kb/publish', { versionIds: [d.body.id] });
    const un = await import('../functions/api/kb/unpublish');
    const r = await call(un.onRequestPost, 'POST', '/api/kb/unpublish', { docKey: 'qa-unpub' });
    expect(Number(r.body.releaseNo.slice(1))).toBe(Number(p.body.releaseNo.slice(1)) + 1);
    const dd = await call(doc.onRequestGet, 'GET', '/api/kb/docs/qa-unpub', undefined, {}, { docKey: 'qa-unpub' });
    expect(dd.body.doc.chunks).toBe(0);
    expect(dd.body.doc.currentVersion).toBeNull();
    await expect(call(un.onRequestPost, 'POST', '/api/kb/unpublish', { docKey: 'qa-unpub' })).rejects.toMatchObject({ status: 409 });
    // 下线后可回滚到曾发布的 v1 重新上线
    const rb = await call(rollback.onRequestPost, 'POST', '/api/kb/rollback', { docKey: 'qa-unpub', version: 1 });
    expect(rb.body.rolledBackTo).toBe(1);
  });
});

describe('草稿原地更新（versionId）', () => {
  it('versionId 指向 draft → 更新同一版本；指向已发布 → 400', async () => {
    const a = await call(docs.onRequestPost, 'POST', '/api/kb/docs', { docKey: 'qa-inplace', title: '原地更新', category: 'investor_edu', content: '## 段\n第一版内容。', changeNote: 'v1' });
    const b = await call(docs.onRequestPost, 'POST', '/api/kb/docs', { versionId: a.body.id, docKey: 'qa-inplace', title: '原地更新', category: 'investor_edu', content: '## 段\n第二次保存的内容。', changeNote: 'v1-改' });
    expect(b.body.id).toBe(a.body.id);
    expect(b.body.updated).toBe(true);
    expect(b.body.content).toContain('第二次保存');
    const d = await call(doc.onRequestGet, 'GET', '/api/kb/docs/qa-inplace', undefined, {}, { docKey: 'qa-inplace' });
    expect(d.body.versions.length).toBe(1);
    await call(publish.onRequestPost, 'POST', '/api/kb/publish', { versionIds: [a.body.id] });
    await expect(call(docs.onRequestPost, 'POST', '/api/kb/docs', { versionId: a.body.id, docKey: 'qa-inplace', title: '原地更新', category: 'investor_edu', content: '## 段\n改已发布。' })).rejects.toMatchObject({ status: 400 });
    await expect(call(docs.onRequestPost, 'POST', '/api/kb/docs', { versionId: a.body.id, docKey: 'rule-fees', title: 'x', category: 'investor_edu', content: '## 段\nx。' })).rejects.toMatchObject({ status: 400 });
  });
});
