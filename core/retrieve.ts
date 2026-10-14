// 检索：BM25（CJK 二元组 + 词表词）与 hybrid（0.65·cos + 0.35·BM25 归一化）。
import type { Chunk, Retrieved } from './types';
import { tokenize } from './tokenize';

export const HYBRID_W_VEC = 0.65;
export const HYBRID_W_KW = 0.35;

export interface KeywordIndex {
  /** 返回每个 chunk 的归一化 BM25 分（0..1），按 chunks 顺序 */
  scoreAll(q: string): number[];
  /** 查询词在语料中的覆盖率（idf 加权，本地模式 coverage 代理） */
  queryCoverage(q: string, chunkIdx: number[]): number;
  chunks: Chunk[];
}

const K1 = 1.2;
const B = 0.75;

export function buildKeywordIndex(chunks: Chunk[]): KeywordIndex {
  const docs = chunks.map((c) => {
    // 标题与小标题各计一次额外权重
    const toks = tokenize(`${c.docTitle} ${c.heading} ${c.heading} ${c.text}`);
    const tf = new Map<string, number>();
    for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);
    return { tf, len: toks.length };
  });
  const N = docs.length;
  const avgdl = N ? docs.reduce((a, d) => a + d.len, 0) / N : 1;
  const df = new Map<string, number>();
  for (const d of docs) for (const t of d.tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  const idf = (t: string) => { const n = df.get(t) ?? 0; return Math.log(1 + (N - n + 0.5) / (n + 0.5)); };

  const qTerms = (q: string) => [...new Set(tokenize(q))];

  return {
    chunks,
    scoreAll(q) {
      const terms = qTerms(q);
      if (!terms.length || !N) return chunks.map(() => 0);
      const weights = terms.map(idf);
      // 归一化分母：每个查询词在平均长度文档里出现 1 次时的得分之和（= Σidf）
      const denom = weights.reduce((a, b) => a + b, 0) || 1;
      const ratios = docs.map((d) => {
        let s = 0;
        const norm = K1 * (1 - B + (B * d.len) / avgdl);
        terms.forEach((t, i) => {
          const f = d.tf.get(t);
          if (f) s += weights[i] * ((f * (K1 + 1)) / (f + norm));
        });
        return s / denom;
      });
      // 超过 1 时整体等比缩放（保留排序分辨率，而不是全部截成 1）
      const scale = Math.max(1, ...ratios);
      return ratios.map((r) => r / scale);
    },
    queryCoverage(q, idxs) {
      const terms = qTerms(q);
      if (!terms.length) return 0;
      let tot = 0; let hit = 0;
      for (const t of terms) {
        const w = idf(t); tot += w;
        if (idxs.some((i) => docs[i]?.tf.has(t))) hit += w;
      }
      return tot ? hit / tot : 0;
    },
  };
}

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length);
  let dot = 0; let na = 0; let nb = 0;
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export interface RetrieveOptions { topK?: number; minScore?: number }
const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** 纯关键词检索器（浏览器本地模式 / embedding 失败兜底） */
export function createKeywordRetriever(chunks: Chunk[], opts: RetrieveOptions = {}) {
  const idx = buildKeywordIndex(chunks);
  const topK = opts.topK ?? 6;
  const minScore = opts.minScore ?? 0.2;
  const retrieve = async (q: string): Promise<{ hits: Retrieved[]; mode: 'hybrid' | 'keyword' }> => ({ hits: keywordSearch(idx, q, topK, minScore), mode: 'keyword' });
  return Object.assign(retrieve, { index: idx, search: (q: string) => keywordSearch(idx, q, topK, minScore) });
}

export function keywordSearch(idx: KeywordIndex, q: string, topK = 6, minScore = 0.2): Retrieved[] {
  const kw = idx.scoreAll(q);
  return idx.chunks
    .map((chunk, i) => ({ chunk, score: r3(kw[i]), kw: r3(kw[i]) }))
    .filter((r) => r.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

/**
 * hybrid 检索器：embedQuery 失败时抛出由调用方降级（见 createHybridRetriever 的 onEmbedError）。
 * 无 embedding 的块按纯关键词分参与排序。
 */
export function createHybridRetriever(chunks: Chunk[], embedQuery: (q: string) => Promise<number[]>, opts: RetrieveOptions & { onEmbedError?: (e: unknown) => void } = {}) {
  const idx = buildKeywordIndex(chunks);
  const topK = opts.topK ?? 6;
  const minScore = opts.minScore ?? 0.2;
  return async (q: string): Promise<{ hits: Retrieved[]; mode: 'hybrid' | 'keyword' }> => {
    let qv: number[] | null = null;
    try { qv = await embedQuery(q); if (!qv || !qv.length) throw new Error('empty embedding'); }
    catch (e) { opts.onEmbedError?.(e); return { hits: keywordSearch(idx, q, topK, minScore), mode: 'keyword' }; }
    const kw = idx.scoreAll(q);
    const hits = chunks.map((chunk, i) => {
      if (!chunk.embedding?.length) return { chunk, score: r3(kw[i]), kw: r3(kw[i]) };
      const vec = cosine(qv!, chunk.embedding);
      return { chunk, score: r3(HYBRID_W_VEC * vec + HYBRID_W_KW * kw[i]), vec: r3(vec), kw: r3(kw[i]) };
    })
      .filter((r) => r.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
    return { hits, mode: 'hybrid' };
  };
}
