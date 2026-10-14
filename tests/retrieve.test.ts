import { describe, expect, it } from 'vitest';
import { buildKeywordIndex, cosine, createHybridRetriever, createKeywordRetriever } from '../core/retrieve';
import { tokenize, charBigramSet, jaccard } from '../core/tokenize';
import { fixtureChunks } from './helpers/mocks';

describe('tokenize', () => {
  it('词表词整体保留 + 段内二元组，丢弃功能词', () => {
    const t = tokenize('科创板开户需要什么条件？');
    expect(t).toContain('科创板');
    expect(t).toContain('开户');
    expect(t).not.toContain('什么');
    expect(t).not.toContain('板开');   // 不产生跨词边界二元组
  });
  it('全角/大小写归一', () => { expect(tokenize('ＥＴＦ')).toEqual(tokenize('etf')); });
  it('charBigramSet / jaccard', () => {
    expect(jaccard(charBigramSet('基金赎回多久到账'), charBigramSet('基金赎回多久到账'))).toBe(1);
    expect(jaccard(charBigramSet('基金赎回'), charBigramSet('科创板'))).toBe(0);
  });
});

describe('BM25 关键词检索', () => {
  const chunks = fixtureChunks();
  it('把相关块排第一，分数归一化在 0..1', async () => {
    const r = await createKeywordRetriever(chunks)('科创板开通权限的条件');
    expect(r.mode).toBe('keyword');
    expect(r.hits[0].chunk.docKey).toBe('rule-star');
    for (const h of r.hits) { expect(h.score).toBeGreaterThan(0); expect(h.score).toBeLessThanOrEqual(1); }
  });
  it('市盈率问题命中投教文档', async () => {
    const r = await createKeywordRetriever(chunks)('市盈率怎么理解');
    expect(r.hits[0].chunk.docKey).toBe('edu-pe');
  });
  it('无关问题不过阈值（minScore 0.2）', async () => {
    const r = await createKeywordRetriever(chunks)('美联储加息对比特币的影响');
    expect(r.hits.length).toBe(0);
  });
  it('topK 限制与空语料', async () => {
    expect((await createKeywordRetriever(chunks, { topK: 1, minScore: 0 })('科创板')).hits.length).toBe(1);
    expect((await createKeywordRetriever([])('科创板')).hits).toEqual([]);
    expect(buildKeywordIndex([]).scoreAll('x')).toEqual([]);
  });
});

describe('hybrid 检索', () => {
  const base = fixtureChunks();
  const vec = (i: number) => Array.from({ length: 8 }, (_, k) => (k === i ? 1 : 0));
  const chunks = base.map((c, i) => ({ ...c, embedding: vec(i % 8) }));
  it('score = 0.65·cos + 0.35·kw', async () => {
    const r = await createHybridRetriever(chunks, async () => vec(0), { minScore: 0 })('科创板开通条件');
    expect(r.mode).toBe('hybrid');
    const h = r.hits.find((x) => x.chunk.id === chunks[0].id)!;
    expect(h.vec).toBe(1);
    expect(h.score).toBeCloseTo(0.65 * 1 + 0.35 * (h.kw ?? 0), 2);
  });
  it('embedding 失败 → 降级 keyword 并回调', async () => {
    let err = '';
    const r = await createHybridRetriever(chunks, async () => { throw new Error('boom'); }, { onEmbedError: (e) => { err = String(e); } })('科创板开通条件');
    expect(r.mode).toBe('keyword');
    expect(err).toContain('boom');
    expect(r.hits[0].chunk.docKey).toBe('rule-star');
  });
  it('cosine', () => { expect(cosine([1, 0], [1, 0])).toBe(1); expect(cosine([1, 0], [0, 1])).toBe(0); expect(cosine([0, 0], [1, 1])).toBe(0); });
});
