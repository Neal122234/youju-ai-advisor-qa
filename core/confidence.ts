// 引用校验、落地性（grounding）、置信度与分档（SPEC §5 步骤 7–9）、适当性比对（步骤 10）。
import type { Chunk, Decision, ProductRisk, RiskLevel } from './types';
import { charBigramSet, financeTermsIn, normalizeText } from './tokenize';
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
  missingNumbers: string[];
  /** 句中关键术语（领域词、英文缩写）在依据块里找不到 */
  missingTerms: string[];
  /** 与依据原句相比，否定/量词发生变化（"部分 ETF"→"ETF"、"不能"→"可以"） */
  qualifierChange: string | null;
  /** 句子主体与依据原句主体不一致（句子讲 ETF，依据原句讲 LOF） */
  subjectMismatch: string | null;
  supported: boolean;
  /** 所引块不支撑、但其它块高度重合 → 应改引最佳块 */
  recite: boolean;
}
export const SENT_SUPPORT = 0.35;   // 句子与资料的字二元组重合率下限
export const SENT_SUPPORT_NUMERIC = 0.25;   // 句中数字全部在依据块中出现时的重合率下限
export const SENT_AUTOCITE = 0.6;   // 无引用句自动补引用的重合率下限（还需无资料外数字/术语、无限定词变化）

/** 泛化词不参与"关键术语"核验（几乎每段资料都会出现或可自然转述） */
const GENERIC_TERMS = new Set(['风险', '收益', '投资者', '本金', '亏损', '账户', '资产', '开通', '权限', '门槛', '交易日', '委托', '成交', '申报', '投教',
  '投资者教育', '理财', '证券账户', '资金账户', '交易所', '基金', '股票', '市值', '新股', '分红', '波动', '流动性', '杠杆', '手续费', '佣金', '密码', 'app']);
// 量词只在修饰对象时计（"部分 ETF""所有投资者"），"超过部分可按 1 股递增"里的"部分"不算
const QUANT_RE = /(部分|个别|某些|一些|多数|大部分|大多数|少数|全部|所有|一律|仅|只有)(?=\s*[\u4e00-\u9fa5a-z]{0,4}?(etf|lof|基金|品种|股票|证券|产品|券商|投资者|债券|公司|板块|情况|交易|个股|账户|客户|业务))/gi;
const NEG_RE_RAW = /(不能|不可以|不可|不得|不允许|不会|不是|不需要|不用|不再|不予|不设|不收|不受|不计|不参与|不支持|无需|无法|禁止|没有|未|勿|免征|免收)/;
/** "未转股/未成年/未满/未到期/未来…"里的"未""无"是名词性修饰，不是谓语否定，比较前先遮蔽 */
const NEG_NOUN_MASK = /(未转股|未成年|未满|未到期|未了结|未缴款|未缴|未上市|未成交|未披露|未公开|未分配|未结清|未来|未交收|无风险|无论|不足|不限|不定期)/g;
const NEG_RE = { test: (t: string) => NEG_RE_RAW.test(t.replace(NEG_NOUN_MASK, '□')) };

function keyTerms(sentence: string): string[] {
  const t = normalizeText(sentence.replace(/\[\d+\]/g, ''));
  const dict = financeTermsIn(t).filter((w) => !GENERIC_TERMS.has(w));
  // 去掉被更长词包含的短词（"科创板"已含"科创"）
  const terms = dict.filter((w) => !dict.some((o) => o !== w && o.includes(w)));
  const ascii = t.match(/[a-z][a-z0-9+*]{1,}/g) ?? [];
  return [...new Set([...terms, ...ascii])];
}

/** 逐句核验：重合率 + 数字核验 + 关键术语核验 + 否定/量词变化核验。任一不过关视为无依据。 */
/** 常见同义/简称（核验术语时，原文出现任一写法即算覆盖） */
export const SYNONYMS: Record<string, string[]> = {
  两融: ['融资融券'], 融资融券: ['两融'], 爆仓: ['强制平仓', '平仓'], 货币基金: ['货币市场基金', '货币型'], 债券基金: ['债券型基金', '纯债', '债基'],
  股票型基金: ['股票基金'], 混合型基金: ['混合基金'], 开户: ['开立', '开通'], 销户: ['注销'], 转户: ['转托管'], etf: ['交易型开放式指数基金'],
  lof: ['上市型开放式基金'], 交易经验: ['参与证券交易', '证券交易', '交易满'], 日均资产: ['资产日均', '日均'], 资产要求: ['日均', '资产'], 赎回: ['申赎'], 申购: ['申赎'], 基金净值: ['净值'], 涨跌幅限制: ['涨跌幅'], 跌停: ['涨跌幅'], 涨停: ['涨跌幅'], 打新: ['新股申购'], 逆回购: ['国债逆回购'], 三方存管: ['第三方存管'], 新三板: ['全国股转'],
};
/** 产品/业务主体词（从具体到宽泛）。问题主体与被引资料主体不一致时（问基金分红税、资料讲股票红利税）判为不覆盖 */
const SUBJECTS: string[][] = [
  ['联接基金'], ['etf', '交易型开放式指数基金'], ['lof', '上市型开放式基金'], ['reits', '基础设施基金'], ['qdii'], ['fof'],
  ['货币基金', '货币市场基金', '货币型'], ['债券基金', '债券型基金', '纯债'], ['指数基金'], ['股票型基金', '股票基金'], ['混合型基金', '混合基金'], ['私募基金', '私募'],
  ['可交换债'], ['可转债', '可转换公司债券'], ['国债期货'], ['国债逆回购', '逆回购'], ['国债'], ['股票期权', '期权'], ['期货'], ['融资融券', '两融', '融资', '融券'],
  ['港股通'], ['北交所', '北京证券交易所'], ['科创板'], ['创业板'], ['新三板'], ['b股'], ['美股'], ['港股'], ['新股', '打新', '申购新股'], ['基金'],
];
const SUBJECT_WORDS = new Set<string>();
/** 文本中出现的主体（各组首词），按出现位置排序 */
export function subjectsIn(text: string): string[] {
  // 括号里的补充说明（"不包括通过融资融券融入的资金"）不算主体
  const t = normalizeText(text).replace(/（[^）]*）|\([^)]*\)/g, '').replace(/\s+/g, '');
  const found = SUBJECTS.map((g) => ({ k: g[0], i: Math.min(...g.map((w) => { const p = t.indexOf(w); return p < 0 ? Infinity : p; })) }))
    .filter((x) => Number.isFinite(x.i) && x.k !== '基金').sort((a, b) => a.i - b.i);
  return found.map((x) => x.k);
}

for (const g of SUBJECTS) for (const w of g) SUBJECT_WORDS.add(w);

/** 返回问题中最具体的主体组（只取最具体的一层，"黄金ETF联接基金"取联接基金/ETF，不取"基金"） */
export function questionSubjects(question: string): string[][] {
  const q = normalizeText(question).replace(/\s+/g, '');
  const hit = SUBJECTS.filter((g) => g.some((w) => q.includes(w)));
  const specific = hit.filter((g) => g[0] !== '基金');
  return specific.length ? specific : hit;
}
/** 被引资料是否覆盖问题主体：问题里任一具体主体在被引块（含标题、小标题）中出现即可 */
export function subjectCovered(question: string, chunks: Chunk[]): { ok: boolean; subjects: string[] } {
  const subs = questionSubjects(question);
  if (!subs.length || !chunks.length) return { ok: true, subjects: [] };
  const pool = normalizeText(chunks.map((c) => `${c.docTitle}${c.heading}${c.text}`).join('')).replace(/\s+/g, '');
  return { ok: subs.some((g) => g.some((w) => pool.includes(w))), subjects: subs.map((g) => g[0]) };
}

/** 问题里出现的术语：答案复述它们不算编造，前提是句子与依据块高度重合（≥ 0.6） */
const QUESTION_TERM_MIN_OVERLAP = 0.6;

export function sentenceEvidence(answer: string, numbered: Chunk[], question = ''): SentenceEvidence[] {
  const qNorm = normNum(normalizeText(question));
  const sets = numbered.map((c) => charBigramSet(`${c.heading}${c.text}`));
  const raw = numbered.map((c) => normNum(`${c.docTitle}${c.heading}${c.text}`));
  // 按分句（逗号级）比较，避免一整句里别的分句的否定/量词干扰
  const srcSents = numbered.map((c) => splitSentences(c.text).flatMap((x) => x.split(/[，,；;：:]/)).filter((x) => x.length >= 4).map((x) => ({ x, b: charBigramSet(x) })));
  // 带所在原句的分句（主体继承用）；"①ETF…②LOF…"按序号再切
  const srcClauses = numbered.map((c) => splitSentences(c.text).flatMap((sent) => sent.split(/(?=[①②③④⑤⑥⑦⑧⑨⑩])/).flatMap((part) => part.split(/[，,；;：:]/).filter((x) => x.length >= 4).map((x) => ({ x, parent: part, b: charBigramSet(x) })))));
  const out: SentenceEvidence[] = [];
  for (const s of factualSentences(answer)) {
    const plain = s.replace(/\[\d+\]/g, '');
    const sb = charBigramSet(plain);
    const ov = (i: number) => { if (!sb.size) return 0; let n = 0; for (const b of sb) if (sets[i].has(b)) n++; return n / sb.size; };
    const cited = [...new Set(extractCitations(s))].filter((n) => n >= 1 && n <= numbered.length);
    let best = 0; let bestOverlap = 0;
    numbered.forEach((_, i) => { const o = ov(i); if (o > bestOverlap) { bestOverlap = o; best = i + 1; } });
    const overlap = cited.length ? Math.max(...cited.map((n) => ov(n - 1))) : bestOverlap;
    const recite = cited.length > 0 && overlap < SENT_SUPPORT && bestOverlap >= SENT_AUTOCITE;
    // 依据块：所引块（若支撑）否则最佳块
    const support = cited.length && !recite ? cited : best ? [best] : [];
    const pool = support.map((n) => raw[n - 1]).join('');
    const missingNumbers = numericFacts(s).filter((x) => !pool.includes(normNum(x)) && !raw.join('').includes(normNum(x)));
    const supOverlap = support.length ? Math.max(...support.map((n) => ov(n - 1))) : 0;
    // 术语可在"依据块 + 与本句高度重合（≥0.5）的其他检索块"中找到
    // 同一文档的其他检索块也算（"示例证券 App""R4"可能在同文档另一小节）
    const supDocs = new Set(support.map((n) => numbered[n - 1].docKey));
    const nearPool = pool + numbered.map((_, i) => (ov(i) >= 0.5 ? raw[i] : '')).join('');
    const docPool = nearPool + numbered.map((c, i) => (supDocs.has(c.docKey) ? raw[i] : '')).join('');
    const missingTerms = keyTerms(plain).filter((w) => {
      // 产品/业务主体词（ETF、LOF…）只在依据块与高重合块里找；其他术语可扩展到同一文档的其他检索块
      const termPool = SUBJECT_WORDS.has(w) ? nearPool : docPool;
      if (termPool.includes(normNum(w)) || (SYNONYMS[w] ?? []).some((x) => termPool.includes(normNum(x)))) return false;
      if (pool.includes(normNum(w)) || (SYNONYMS[w] ?? []).some((x) => pool.includes(normNum(x)))) return false;
      if (qNorm.includes(normNum(w)) && supOverlap >= QUESTION_TERM_MIN_OVERLAP) return false;
      // 复合术语：其中更短的领域词在依据块中出现即可（"涨跌幅限制"⊃"涨跌幅"、"基金净值"⊃"净值"）
      if (financeTermsIn(w).some((sub) => sub !== w && sub.length >= 2 && !GENERIC_TERMS.has(sub) && termPool.includes(normNum(sub)))) return false;
      // 术语的字二元组全部来自问题（问题里拆开写的"涨跌幅有限制"）且句子与依据块高度重合
      if (supOverlap >= QUESTION_TERM_MIN_OVERLAP && [...charBigramSet(w)].every((b) => qNorm.includes(b))) return false;
      return true;
    });
    let qualifierChange: string | null = null;
    // 答案逐分句与最相近的依据分句比较否定/量词
    for (const clause of plain.split(/[，,；;：:]/).filter((x) => x.replace(/[^\u3400-\u9fffA-Za-z0-9]/g, '').length >= 4)) {
      const cb = charBigramSet(clause);
      let cs = ''; let co = 0;
      for (const n of support) for (const ss of srcSents[n - 1]) {
        let k = 0; for (const b of cb) if (ss.b.has(b)) k++;
        const o = cb.size ? k / cb.size : 0; if (o > co) { co = o; cs = ss.x; }
      }
      if (!cs || co < 0.6) continue;
      const qs = new Set((cs.match(QUANT_RE) ?? []).map((x) => x.toLowerCase())); const qa = new Set((clause.match(QUANT_RE) ?? []).map((x) => x.toLowerCase()));
      const lost = [...qs].filter((x) => !qa.has(x)); const added = [...qa].filter((x) => !qs.has(x));
      if (lost.length || added.length) { qualifierChange = `量词${lost.length ? `缺失"${lost.join('/')}"` : ''}${added.length ? `新增"${added.join('/')}"` : ''}（原文：${cs.slice(0, 20)}）`; break; }
      if (NEG_RE.test(cs) !== NEG_RE.test(clause)) { qualifierChange = `否定词与原文不一致（原文：${cs.slice(0, 20)}）`; break; }
    }
    // 动作级否定翻转："原文 不能撤单 ↔ 答案 可以撤单"（及反向）
    if (!qualifierChange) {
      const poolText = support.map((n) => normalizeText(numbered[n - 1].text)).join('');
      const negAct = [...poolText.matchAll(/(不能|不可以|不得|不允许|禁止|无法|不可|不支持)([\u4e00-\u9fa5]{2})/g)].map((m) => m[2]);
      const posAct = [...poolText.matchAll(/(?<!不)(可以|可|能|允许|支持)([\u4e00-\u9fa5]{2})/g)].map((m) => m[2]);
      const ap = normalizeText(plain);
      const flipPos = negAct.find((v) => !posAct.includes(v) && new RegExp(`(?<!不)(可以|可|能|允许|支持)${v}`).test(ap) && !new RegExp(`(不能|不可以|不得|不允许|禁止|无法|不可|不支持)${v}`).test(ap));
      const flipNeg = posAct.find((v) => new RegExp(`(不能|不可以|不得|不允许|禁止|无法|不可|不支持)${v}`).test(ap) && !negAct.includes(v));
      if (flipPos) qualifierChange = `否定词与原文不一致（原文：不能/不得${flipPos}）`;
      else if (flipNeg) qualifierChange = `否定词与原文不一致（原文：可以${flipNeg}）`;
    }
    // 按分句核对主体：答案分句的主体（无则继承本句主体）与最相近依据分句的主体（无则继承其所在原句主体）不相交 → 不支持
    let subjectMismatch: string | null = null;
    const sentSubj = subjectsIn(plain);
    for (const clause of plain.split(/[，,；;：:]/).filter((x) => x.replace(/[^\u3400-\u9fffA-Za-z0-9]/g, '').length >= 4)) {
      const aSubj = subjectsIn(clause).length ? subjectsIn(clause) : sentSubj;
      if (!aSubj.length) continue;
      const cb = charBigramSet(clause);
      // 候选：依据块 + 与本句高度重合的其他检索块（模型可能引错块，原文在别的块里）
      const cand = [...new Set([...support, ...numbered.map((_, i) => (ov(i) >= 0.5 ? i + 1 : 0)).filter(Boolean)])];
      const matches: { subj: string[]; o: number }[] = [];
      for (const n of cand) for (const ss of srcClauses[n - 1]) {
        let k = 0; for (const b of cb) if (ss.b.has(b)) k++;
        const o = cb.size ? k / cb.size : 0;
        if (o >= 0.4) matches.push({ subj: subjectsIn(ss.x).length ? subjectsIn(ss.x) : subjectsIn(ss.parent).slice(0, 1), o });
      }
      if (!matches.length) continue;
      // 只要有一个高度相近的原文分句主体一致（或原文分句没有主体），就不算不一致
      if (matches.some((m) => !m.subj.length || aSubj.some((x) => m.subj.includes(x)))) continue;
      const top = matches.sort((x, y) => y.o - x.o)[0];
      subjectMismatch = `主体不一致（答案：${aSubj.join('/')}，原文：${top.subj.join('/')}）`; break;
    }
    // 含数字的短句（"开盘时间为 9:30"）：数字全部能在依据块里找到时，重合率门槛放宽到 0.25
    const nums = numericFacts(s);
    const numericAnchored = nums.length > 0 && nums.every((x) => pool.includes(normNum(x)));
    const threshold = numericAnchored ? SENT_SUPPORT_NUMERIC : SENT_SUPPORT;
    const supported = (overlap >= threshold || recite) && !missingNumbers.length && !missingTerms.length && !qualifierChange && !subjectMismatch;
    out.push({ text: s, cited, overlap: round(overlap), best, bestOverlap: round(bestOverlap), missingNumbers, missingTerms, qualifierChange, subjectMismatch, recite, supported });
  }
  return out;
}
