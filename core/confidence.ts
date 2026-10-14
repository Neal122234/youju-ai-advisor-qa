// 引用校验、落地性（grounding）、置信度与分档（SPEC §5 步骤 7–9）、适当性比对（步骤 10）。
import type { Chunk, Decision, ProductRisk, RiskLevel } from './types';
import { charBigramSet } from './tokenize';
import { splitSentences } from './chunk';

export const W = { retrieval: 0.35, coverage: 0.25, grounding: 0.25, citation: 0.15 } as const;
export const T_ANSWER = 0.62;
export const T_CAVEAT = 0.45;

const CITE_RE = /[\[【]\s*(\d+(?:\s*[,，、]\s*\d+)*)\s*[\]】]/g;

/** 抽取答案中的引用编号（支持 [1] [1,2] 【1】） */
export function extractCitations(answer: string): number[] {
  const out: number[] = [];
  CITE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CITE_RE.exec(answer))) for (const n of m[1].split(/[,，、]/)) out.push(Number(n.trim()));
  return out;
}

export interface CitationCheck { valid: number[]; invalid: number[]; total: number; cleaned: string; citedSentenceRatio: number; score: number }

/** 引用校验：编号必须在 1..k；非法编号从正文剔除。score = 合法引用率 ×（0.4 + 0.6×有引用的事实句占比） */
export function validateCitations(answer: string, k: number): CitationCheck {
  const nums = extractCitations(answer);
  const valid = [...new Set(nums.filter((n) => n >= 1 && n <= k))];
  const invalid = [...new Set(nums.filter((n) => !(n >= 1 && n <= k)))];
  const cleaned = answer.replace(CITE_RE, (_all, grp: string) => {
    const keep = grp.split(/[,，、]/).map((x) => Number(x.trim())).filter((n) => n >= 1 && n <= k);
    return keep.length ? `[${keep.join('][')}]` : '';
  });
  const sents = factualSentences(cleaned);
  const cited = sents.filter((s) => /\[\d+\]/.test(s)).length;
  const ratio = sents.length ? cited / sents.length : 0;
  const rate = nums.length ? (nums.length - nums.filter((n) => !(n >= 1 && n <= k)).length) / nums.length : 0;
  const score = nums.length ? rate * (0.4 + 0.6 * ratio) : 0;
  return { valid, invalid, total: nums.length, cleaned, citedSentenceRatio: ratio, score: round(score) };
}

/** 事实句：去掉过短的句子 */
export function factualSentences(text: string): string[] {
  return splitSentences(text).filter((s) => s.replace(/\[\d+\]/g, '').replace(/[^㐀-鿿A-Za-z0-9]/g, '').length >= 6);
}

/** 逐句字二元组重合率（句子二元组被引块覆盖的比例）的平均值 */
export function computeGrounding(answer: string, numbered: Chunk[]): number {
  const sents = factualSentences(answer);
  if (!sents.length || !numbered.length) return 0;
  const allCited = [...new Set(extractCitations(answer))].filter((n) => n >= 1 && n <= numbered.length);
  const pool = (ns: number[]) => {
    const set = new Set<string>();
    for (const n of ns) for (const b of charBigramSet(`${numbered[n - 1].heading}${numbered[n - 1].text}`)) set.add(b);
    return set;
  };
  const poolAll = pool(allCited.length ? allCited : numbered.map((_, i) => i + 1));
  let sum = 0;
  for (const s of sents) {
    const own = extractCitations(s).filter((n) => n >= 1 && n <= numbered.length);
    const ref = own.length ? pool(own) : poolAll;
    const sb = charBigramSet(s.replace(/\[\d+\]/g, ''));
    if (!sb.size) continue;
    let inter = 0; for (const b of sb) if (ref.has(b)) inter++;
    sum += inter / sb.size;
  }
  return round(sum / sents.length);
}

/** top1 检索分归一化到 0..1（hybrid 0.30→0、0.75→1；keyword 0.20→0、0.70→1） */
export function normalizeRetrieval(top1: number, mode: 'hybrid' | 'keyword'): number {
  const [lo, hi] = mode === 'hybrid' ? [0.3, 0.75] : [0.2, 0.7];
  return round(Math.max(0, Math.min(1, (top1 - lo) / (hi - lo))));
}

export interface Breakdown { retrieval: number; coverage: number; grounding: number; citation: number }
export function computeConfidence(b: Breakdown): number {
  return round(W.retrieval * b.retrieval + W.coverage * b.coverage + W.grounding * b.grounding + W.citation * b.citation);
}
export function decideByConfidence(c: number): Extract<Decision, 'answered' | 'answered_caveat' | 'handoff_low_conf'> {
  return c >= T_ANSWER ? 'answered' : c >= T_CAVEAT ? 'answered_caveat' : 'handoff_low_conf';
}

/** 适当性：C≥R 才匹配 */
export function matchSuitability(userRisk: RiskLevel, productRisk: ProductRisk): boolean {
  return Number(userRisk.slice(1)) >= Number(productRisk.slice(1));
}
export function maxProductRisk(chunks: Chunk[]): ProductRisk | null {
  let best: ProductRisk | null = null;
  for (const c of chunks) if (c.productRisk && (!best || Number(c.productRisk.slice(1)) > Number(best.slice(1)))) best = c.productRisk;
  return best;
}

export const round = (x: number) => Math.round(x * 1000) / 1000;

/* ---------------- 逐句证据核验 ---------------- */
/** 把"。[3]"这类标点后的引用挪到句末标点前，保证引用与句子绑定 */
export function attachCitations(answer: string): string {
  return answer.replace(/([。！？；;!?])\s*((?:[\[【]\s*\d+(?:\s*[,，、]\s*\d+)*\s*[\]】])+)/g, '$2$1');
}

/** 句中出现的数字/比例/T+n 等"硬事实"，必须能在资料原文中找到 */
const NUM_RE = /t\s*\+\s*\d+|\d+(?:\.\d+)?\s*(?:%|个?交易日|万元?|元|股|年|个月|天|日|小时|点|倍|手)?/gi;
export function numericFacts(s: string): string[] {
  return [...new Set((s.replace(/\[\d+\]/g, '').toLowerCase().match(NUM_RE) ?? []).map((x) => x.replace(/\s+/g, '')).filter((x) => /\d/.test(x)))];
}
const normNum = (s: string) => s.toLowerCase().replace(/\s+/g, '').replace(/[，,]/g, '');

export interface SentenceEvidence {
  text: string; cited: number[]; overlap: number; best: number; bestOverlap: number;
  missingNumbers: string[]; supported: boolean;
  /** 所引块不支撑、但其它块高度重合 → 应改引最佳块 */
  recite: boolean;
}
export const SENT_SUPPORT = 0.35;   // 句子与资料的字二元组重合率下限
export const SENT_AUTOCITE = 0.5;   // 无引用句自动补引用的重合率下限

/** 逐句核验：重合率（对所引块，无引用则对最佳块）+ 数字核验。不过关的句子视为无依据。 */
export function sentenceEvidence(answer: string, numbered: Chunk[]): SentenceEvidence[] {
  const sets = numbered.map((c) => charBigramSet(`${c.heading}${c.text}`));
  const raw = numbered.map((c) => normNum(`${c.docTitle}${c.heading}${c.text}`));
  const out: SentenceEvidence[] = [];
  for (const s of factualSentences(answer)) {
    const sb = charBigramSet(s.replace(/\[\d+\]/g, ''));
    const ov = (i: number) => { if (!sb.size) return 0; let n = 0; for (const b of sb) if (sets[i].has(b)) n++; return n / sb.size; };
    const cited = [...new Set(extractCitations(s))].filter((n) => n >= 1 && n <= numbered.length);
    let best = 0; let bestOverlap = 0;
    numbered.forEach((_, i) => { const o = ov(i); if (o > bestOverlap) { bestOverlap = o; best = i + 1; } });
    const overlap = cited.length ? Math.max(...cited.map((n) => ov(n - 1))) : bestOverlap;
    const pool = cited.length ? cited.map((n) => raw[n - 1]).join('') : raw.join('');
    const missingNumbers = numericFacts(s).filter((x) => !pool.includes(normNum(x)) && !raw.join('').includes(normNum(x)));
    const recite = cited.length > 0 && overlap < SENT_SUPPORT && bestOverlap >= SENT_AUTOCITE;
    out.push({ text: s, cited, overlap: round(overlap), best, bestOverlap: round(bestOverlap), missingNumbers, recite, supported: (overlap >= SENT_SUPPORT || recite) && missingNumbers.length === 0 });
  }
  return out;
}
