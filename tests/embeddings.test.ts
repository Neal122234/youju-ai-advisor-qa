// 预计算向量：float16 编解码、导出、seed 优先使用（不调用 AI）
import { describe, expect, it } from 'vitest';
import { chunkFingerprint, decodeF16Base64, encodeF16Base64 } from '../core/f16';
import { cosine } from '../core/retrieve';
import { buildBundle } from '../scripts/export-embeddings';
import { createFakeD1 } from './helpers/fakeD1';
import { BUNDLE, invalidateKbCache } from '../functions/_lib/db';
import * as seed from '../functions/api/admin/seed';

const rand = (n: number, seedv = 1) => { let x = seedv; const v = Array.from({ length: n }, () => { x = (x * 16807) % 2147483647; return x / 2147483647 - 0.5; }); const norm = Math.hypot(...v); return v.map((a) => a / norm); };

describe('float16 + base64', () => {
  it('往返误差小、余弦几乎不变、体积约为 JSON 的 1/3', () => {
    const a = rand(1024, 7); const b = rand(1024, 11);
    const a2 = decodeF16Base64(encodeF16Base64(a)); const b2 = decodeF16Base64(encodeF16Base64(b));
    expect(a2.length).toBe(1024);
    expect(Math.max(...a.map((x, i) => Math.abs(x - a2[i])))).toBeLessThan(2e-4);
    expect(Math.abs(cosine(a, b) - cosine(a2, b2))).toBeLessThan(1e-3);
    expect(encodeF16Base64(a).length).toBeLessThan(JSON.stringify(a.map((x) => Math.round(x * 1e5) / 1e5)).length / 2.5);
  });
  it('边界值', () => {
    expect(decodeF16Base64(encodeF16Base64([0, 1, -1, 0.5, 1e-6, 65504]))).toEqual([0, 1, -1, 0.5, expect.any(Number), 65504]);
  });
  it('内容指纹随内容变化', () => {
    expect(chunkFingerprint('a', 'b')).toBe(chunkFingerprint('a', 'b'));
    expect(chunkFingerprint('a', 'b')).not.toBe(chunkFingerprint('a', 'c'));
  });
});

describe('export-embeddings', () => {
  it('从 D1 查询行构建 bundle（跳过空向量）', () => {
    const v = rand(8, 3);
    const b = buildBundle([{ id: 'x@v1#0', heading: 'h', text: 't', embedding: JSON.stringify(v) }, { id: 'y@v1#0', heading: 'h', text: 't', embedding: null }], 'test');
    expect(Object.keys(b.chunks)).toEqual(['x@v1#0']);
    expect(b.dims).toBe(8);
    expect(b.chunks['x@v1#0'].fp).toBe(chunkFingerprint('h', 't'));
  });
});

describe('seed 优先使用预计算向量', () => {
  it('全部命中时不调用 AI；内容变了的块回退 AI', async () => {
    const chunks = BUNDLE.chunks;
    const pre = buildBundle(chunks.map((c, i) => ({ id: c.id, heading: c.heading, text: i === 0 ? '旧内容' : c.text, embedding: JSON.stringify(rand(16, i + 1)) })), 'test');
    seed.__setPrecomputed(pre);
    let aiCalls = 0; let aiTexts = 0;
    const env: any = { DB: createFakeD1(), AI: { run: async (_m: string, inp: any) => { aiCalls++; aiTexts += inp.text.length; return { data: inp.text.map(() => rand(16, 99)) }; } } };
    invalidateKbCache();
    const res: Response = await (seed.onRequestPost as any)({ request: new Request('http://localhost/api/admin/seed', { method: 'POST' }), env, params: {}, next: async () => new Response(), waitUntil() {}, data: {} });
    const body = await res.json() as any;
    expect(body.done).toBe(true);
    expect(body.fromPrecomputed).toBe(chunks.length - 1);
    expect(body.fromAi).toBe(1);
    expect(aiTexts).toBe(1);
    expect(aiCalls).toBe(1);
    // 不配 AI 也能完成（全部来自预计算）
    seed.__setPrecomputed(buildBundle(chunks.map((c, i) => ({ id: c.id, heading: c.heading, text: c.text, embedding: JSON.stringify(rand(16, i + 1)) })), 'test'));
    const env2: any = { DB: createFakeD1() };
    const r2: Response = await (seed.onRequestPost as any)({ request: new Request('http://localhost/api/admin/seed', { method: 'POST' }), env: env2, params: {}, next: async () => new Response(), waitUntil() {}, data: {} });
    const b2 = await r2.json() as any;
    expect(b2.fromPrecomputed).toBe(chunks.length);
    expect(b2.pending).toBe(0);
    seed.__setPrecomputed({ model: '', dims: 0, format: 'f16-base64', exportedAt: '', source: 'none', chunks: {} });
  });
});
