// 知识缺口归并（SPEC §6）：问题归一化（去标点/语气词）→ 字二元组 Jaccard ≥ 0.5 合并。
import { charBigramSet, jaccard, normalizeText } from './tokenize';

export const GAP_MERGE_THRESHOLD = 0.5;
const FILLERS = /(请问|你好|您好|麻烦|想问一下|想问|问一下|我想知道|我想了解|能不能告诉我|告诉我|一下|谢谢|啊|呀|呢|吧|吗|嘛|哦|啦|么|了)/g;

export function normalizeQuestion(q: string): string {
  return normalizeText(q).replace(FILLERS, '').replace(/[^㐀-鿿a-z0-9+]/g, '');
}
export function questionSimilarity(a: string, b: string): number {
  return jaccard(charBigramSet(normalizeQuestion(a)), charBigramSet(normalizeQuestion(b)));
}
/** 在候选 gap 中找可合并的那条（相似度最高且 ≥ 阈值） */
export function findMergeTarget<T extends { normKey: string; questions?: string[] }>(question: string, gaps: T[], threshold = GAP_MERGE_THRESHOLD): T | null {
  const nk = normalizeQuestion(question);
  const qb = charBigramSet(nk);
  let best: T | null = null; let bestS = 0;
  for (const g of gaps) {
    const cands = [g.normKey, ...(g.questions ?? []).map(normalizeQuestion)];
    const s = Math.max(...cands.map((c) => jaccard(qb, charBigramSet(c))));
    if (s >= threshold && s > bestS) { best = g; bestS = s; }
  }
  return best;
}
