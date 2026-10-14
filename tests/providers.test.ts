// 备用模型通道：Workers AI 额度耗尽（4006）→ SiliconFlow；熔断；双失败 → degraded；embedding 切换
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLlm, embedTextsDetailed, isQuotaError, providerState, resetProviderState, QUOTA_BREAKER_MS } from '../functions/_lib/ai';
import { runPipeline } from '../core/pipeline';
import { makeAdapters } from './helpers/mocks';

const KEY = 'sk-test-0123456789abcdef';
const msgs = [{ role: 'system', content: '你是助手' }, { role: 'user', content: '【资料】\n[1] 《t》· h（v1）\n科创板需日均资产不低于 50 万元。\n\n【可回答的问题】科创板条件' }];
let fetchCalls: { url: string; body: any }[] = [];
function stubFetch(handler: (url: string, body: any) => { status?: number; json: any }) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => {
    const body = JSON.parse(init.body); fetchCalls.push({ url, body });
    const r = handler(url, body);
    return new Response(JSON.stringify(r.json), { status: r.status ?? 200 });
  }));
}
const sfChatOk = () => stubFetch((url) => (url.endsWith('/chat/completions')
  ? { json: { choices: [{ message: { content: '<think>x</think>{"answer":"科创板需日均资产不低于 50 万元[1]。","used":[1],"covered":true}' } }] } }
  : { json: { data: [{ index: 1, embedding: [0, 1] }, { index: 0, embedding: [1, 0] }] } }));
const quotaAi = () => { let n = 0; return { ai: { run: async () => { n++; throw new Error('4006: you have used up your daily free allocation of 10,000 neurons'); } }, count: () => n }; };

beforeEach(() => { resetProviderState(); fetchCalls = []; });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('额度错误识别', () => {
  it('4006 / daily free allocation 识别为额度错误；普通错误不是', () => {
    expect(isQuotaError(new Error('4006: you have used up your daily free allocation'))).toBe(true);
    expect(isQuotaError(new Error('InferenceUpstreamError: 500'))).toBe(false);
  });
});

describe('chat 通道链', () => {
  it('Workers AI 4006 → 立即切 SiliconFlow，记熔断；熔断期间不再调 Workers AI', async () => {
    sfChatOk();
    const q = quotaAi();
    const h = createLlm({ DB: {} as any, AI: q.ai, SILICONFLOW_API_KEY: KEY, PROVIDER_ORDER: 'workers-ai,siliconflow' }, new Set());
    const out = await h.llm!(msgs);
    expect(out).toContain('50 万元');
    expect(out).not.toContain('<think>');
    expect(h.modelName()).toBe('siliconflow/Qwen/Qwen3-30B-A3B-Instruct-2507');
    expect(h.notes().join()).toContain('4006');
    expect(q.count()).toBe(1);                      // 不再尝试 gpt-oss
    expect(providerState().quotaUntil['workers-ai']).toBeGreaterThan(Date.now());
    const h2 = createLlm({ DB: {} as any, AI: q.ai, SILICONFLOW_API_KEY: KEY, PROVIDER_ORDER: 'workers-ai,siliconflow' }, new Set());
    await h2.llm!(msgs);
    expect(q.count()).toBe(1);                      // 熔断：直接走 SiliconFlow
    expect(h2.notes().join()).toContain('熔断');
    expect(fetchCalls[0].body).toMatchObject({ model: 'Qwen/Qwen3-30B-A3B-Instruct-2507', temperature: 0, stream: false });
  });
  it('熔断到期后重新尝试 Workers AI', async () => {
    sfChatOk();
    vi.useFakeTimers({ toFake: ['Date'] });
    const q = quotaAi();
    const env = { DB: {} as any, AI: q.ai, SILICONFLOW_API_KEY: KEY, PROVIDER_ORDER: 'workers-ai,siliconflow' };
    await createLlm(env, new Set()).llm!(msgs);
    vi.setSystemTime(Date.now() + QUOTA_BREAKER_MS + 1000);
    await createLlm(env, new Set()).llm!(msgs);
    expect(q.count()).toBe(2);
  });
  it('意图分类走 SF_INTENT_MODEL', async () => {
    sfChatOk();
    const h = createLlm({ DB: {} as any, SILICONFLOW_API_KEY: KEY, SF_INTENT_MODEL: 'Qwen/Qwen3-8B' }, new Set());
    await h.llm!(msgs, { purpose: 'intent' });
    expect(fetchCalls[0].body.model).toBe('Qwen/Qwen3-8B');
  });
  it('x-provider 强制 siliconflow：不碰 Workers AI', async () => {
    sfChatOk();
    let n = 0;
    const h = createLlm({ DB: {} as any, AI: { run: async () => { n++; return { response: 'x' }; } }, SILICONFLOW_API_KEY: KEY, PROVIDER_ORDER: 'workers-ai,siliconflow' }, new Set(), undefined, 'siliconflow');
    await h.llm!(msgs);
    expect(n).toBe(0);
    expect(h.modelName()).toMatch(/^siliconflow\//);
  });
  it('普通错误：Workers AI 主模型→gpt-oss 回退→仍失败再试 SiliconFlow', async () => {
    sfChatOk();
    let n = 0;
    const h = createLlm({ DB: {} as any, AI: { run: async () => { n++; throw new Error('InferenceUpstreamError 500'); } }, SILICONFLOW_API_KEY: KEY, PROVIDER_ORDER: 'workers-ai,siliconflow' }, new Set());
    await h.llm!(msgs);
    expect(n).toBe(2);
    expect(h.modelName()).toMatch(/^siliconflow\//);
    expect(providerState().quotaUntil['workers-ai']).toBe(0);
  });
  it('未配置 key：额度错误直接抛出；两者都失败 → 管线 degraded', async () => {
    const q = quotaAi();
    const h = createLlm({ DB: {} as any, AI: q.ai }, new Set());
    await expect(h.llm!(msgs)).rejects.toThrow('4006');
    stubFetch(() => ({ status: 503, json: { error: 'busy' } }));
    const h2 = createLlm({ DB: {} as any, AI: quotaAi().ai, SILICONFLOW_API_KEY: KEY, PROVIDER_ORDER: 'workers-ai,siliconflow' }, new Set());
    const r = await runPipeline({ question: '科创板开通权限需要什么条件', userRisk: 'C4', sessionId: '' }, makeAdapters({ llm: h2.llm, modelName: h2.modelName, providerNotes: h2.notes }), { intentLlm: false });
    expect(r.decision).toBe('degraded');
    expect(r.checks.find((c) => c.name === 'generation')!.detail).toContain('SiliconFlow');
  });
  it('x-fault: llm 对所有通道生效', async () => {
    sfChatOk();
    const h = createLlm({ DB: {} as any, SILICONFLOW_API_KEY: KEY, PROVIDER_ORDER: 'workers-ai,siliconflow' }, new Set(['llm'] as any));
    await expect(h.llm!(msgs)).rejects.toThrow('故障注入');
  });
});

describe('embedding 通道链', () => {
  it('Workers AI 4006 → SiliconFlow bge-m3，按 index 排序', async () => {
    sfChatOk();
    const r = await embedTextsDetailed({ DB: {} as any, AI: quotaAi().ai, SILICONFLOW_API_KEY: KEY, PROVIDER_ORDER: 'workers-ai,siliconflow' }, ['a', 'b']);
    expect(r.provider).toBe('siliconflow');
    expect(r.vectors).toEqual([[1, 0], [0, 1]]);
    expect(r.note).toContain('4006');
    expect(fetchCalls[0].body).toMatchObject({ model: 'BAAI/bge-m3', input: ['a', 'b'] });
  });
  it('Workers AI 正常时不调用 SiliconFlow', async () => {
    sfChatOk();
    const r = await embedTextsDetailed({ DB: {} as any, AI: { run: async (_m: string, i: any) => ({ data: i.text.map(() => [1]) }) }, SILICONFLOW_API_KEY: KEY, PROVIDER_ORDER: 'workers-ai,siliconflow' }, ['a']);
    expect(r.provider).toBe('workers-ai');
    expect(fetchCalls.length).toBe(0);
  });
  it('两者都不可用 → 抛错（检索降级关键词）', async () => {
    await expect(embedTextsDetailed({ DB: {} as any, AI: quotaAi().ai }, ['a'])).rejects.toThrow();
  });
});

describe('默认主备顺序：SiliconFlow 为主、Workers AI 为备', () => {
  it('默认先走 SiliconFlow，不调用 Workers AI', async () => {
    sfChatOk();
    let n = 0;
    const h = createLlm({ DB: {} as any, AI: { run: async () => { n++; return { response: 'x' }; } }, SILICONFLOW_API_KEY: KEY }, new Set());
    await h.llm!(msgs);
    expect(n).toBe(0);
    expect(h.modelName()).toMatch(/^siliconflow\//);
  });
  it('SiliconFlow 402 余额不足 → 熔断并切 Workers AI；熔断期间直接走 Workers AI', async () => {
    stubFetch(() => ({ status: 402, json: { message: 'insufficient balance' } }));
    let n = 0;
    const ai = { run: async () => { n++; return { response: '{"answer":"ok[1]","used":[1],"covered":true}' }; } };
    const h = createLlm({ DB: {} as any, AI: ai, SILICONFLOW_API_KEY: KEY }, new Set());
    await h.llm!(msgs);
    expect(h.modelName()).toMatch(/^workers-ai\//);
    expect(h.notes().join()).toContain('切换 Workers AI');
    expect(providerState().quotaUntil.siliconflow).toBeGreaterThan(Date.now());
    const before = fetchCalls.length;
    const h2 = createLlm({ DB: {} as any, AI: ai, SILICONFLOW_API_KEY: KEY }, new Set());
    await h2.llm!(msgs);
    expect(fetchCalls.length).toBe(before);       // 熔断中不再请求 SiliconFlow
    expect(h2.notes().join()).toContain('熔断');
  });
  it('SiliconFlow 未配置 → 直接用 Workers AI', async () => {
    const h = createLlm({ DB: {} as any, AI: { run: async () => ({ response: 'x' }) } }, new Set());
    await h.llm!(msgs);
    expect(h.modelName()).toMatch(/^workers-ai\//);
  });
  it('PROVIDER_ORDER 解析', async () => {
    const { providerOrder } = await import('../functions/_lib/ai');
    expect(providerOrder({ DB: {} as any })).toEqual(['siliconflow', 'workers-ai', 'siliconflow-lite']);
    expect(providerOrder({ DB: {} as any, PROVIDER_ORDER: 'workers-ai' })).toEqual(['workers-ai', 'siliconflow', 'siliconflow-lite']);
  });
  it('embedding 默认走 SiliconFlow；SF 失败切 Workers AI', async () => {
    stubFetch(() => ({ status: 500, json: {} }));
    const r = await embedTextsDetailed({ DB: {} as any, AI: { run: async (_m: string, i: any) => ({ data: i.text.map(() => [1]) }) }, SILICONFLOW_API_KEY: KEY }, ['a']);
    expect(r.provider).toBe('workers-ai');
    expect(r.note).toContain('切换 Workers AI');
  });
});

describe('主通道超时 → 回退 8B', () => {
  it('SiliconFlow 30B 超过单次上限 → Workers AI 熔断中 → SiliconFlow 8B 成功；总时长在预算内', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => {
      const body = JSON.parse(init.body); fetchCalls.push({ url, body });
      if (body.model === 'Qwen/Qwen3-30B-A3B-Instruct-2507') {
        await new Promise((res, rej) => { const t = setTimeout(res, 5000); init.signal?.addEventListener('abort', () => { clearTimeout(t); const e = new Error('aborted'); (e as any).name = 'AbortError'; rej(e); }); });
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"answer":"ok[1]","used":[1],"covered":true}' } }] }), { status: 200 });
    }));
    const ai = { run: async () => { throw new Error('4006: you have used up your daily free allocation'); } };
    const env: any = { DB: {}, AI: ai, SILICONFLOW_API_KEY: KEY };
    // 先让 Workers AI 进入熔断
    await createLlm({ ...env, PROVIDER_ORDER: 'workers-ai,siliconflow-lite' }, new Set()).llm!(msgs);
    fetchCalls = [];
    const h = createLlm(env, new Set(), 4500);   // 总预算 4.5s：30B 单次上限 = min(8s, 4.5-2.5) = 2s，超时后用剩余 2.5s 回退 8B
    const t = Date.now();
    const out = await h.llm!(msgs, { purpose: 'generate' });
    expect(out).toContain('ok');
    expect(Date.now() - t).toBeLessThan(4500);
    expect(h.modelName('generate')).toBe('siliconflow/Qwen/Qwen3-8B');
    expect(h.notes().join()).toMatch(/SiliconFlow 超时.*→ 切换 SiliconFlow 8B/);
    expect(h.notes().join()).toContain('Workers AI 额度熔断中');
    expect(fetchCalls.map((c) => c.body.model)).toEqual(['Qwen/Qwen3-30B-A3B-Instruct-2507', 'Qwen/Qwen3-8B']);
  });
  it('embedding 链不使用 8B 通道', async () => {
    stubFetch(() => ({ json: { data: [{ index: 0, embedding: [1] }] } }));
    const r = await embedTextsDetailed({ DB: {} as any, SILICONFLOW_API_KEY: KEY }, ['a']);
    expect(r.provider).toBe('siliconflow');
  });
});
