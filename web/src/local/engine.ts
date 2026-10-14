// 本地演示模式：浏览器内运行 core/ 管线（关键词检索 + 规则引擎 + 抽取式回答，llm=null）。
// 日志/告警/缺口/工单/知识库编辑全部存 localStorage，接口形状与线上一致。
import type { ApiClient } from '../api';
import type {
  Alert, ChatRequest, ChatResponse, Chunk, Dashboard, DocInput, DocVersion, EvalItem, EvalRun, Gap, KbDoc, LogDetail,
  PreviewChunk, ProductRisk, Release, RiskLevel, Ticket,
} from '../apiTypes';
import bundleRaw from '../generated/kb-bundle.json';
import { SAMPLE_DOCS, SEED_QUESTIONS } from '../mock';

/* ---------- core bridge ---------- */
import { chunkDocument, parseFrontMatter } from '../../../core/chunk';
import { createKeywordRetriever } from '../../../core/retrieve';
import { runPipeline } from '../../../core/pipeline';
import { findMergeTarget, normalizeQuestion } from '../../../core/gaps';
import { judge, summarize, type EvalQuestion } from '../../../core/eval';
import evalQuestionsRaw from '../../../eval/questions.json';

function chunkDoc(doc: { docKey: string; title: string; version: number; content: string; category: string; productRisk: ProductRisk | null }): Chunk[] {
  return chunkDocument(doc.content, { docKey: doc.docKey, title: doc.title, version: doc.version, category: doc.category, productRisk: doc.productRisk });
}

let retrieverCache: { chunks: Chunk[]; fn: ReturnType<typeof createKeywordRetriever> } | null = null;
async function runChat(req: ChatRequest, chunks: Chunk[], kbRelease: string, id: string): Promise<ChatResponse> {
  if (!retrieverCache || retrieverCache.chunks !== chunks) retrieverCache = { chunks, fn: createKeywordRetriever(chunks) };
  let n = 0;
  const resp = await runPipeline(req, {
    retrieve: retrieverCache.fn, llm: null, kbRelease,
    newId: () => (n++ === 0 ? id : `${id}${n}`),
    scripts: () => chunks.filter((c) => c.category === 'compliance_script'),
  }, { mode: 'local' });
  return { ...resp, id, mode: 'local' };
}

/* ---------- 持久化状态 ---------- */
interface DocMeta { docKey: string; title: string; category: string; productRisk: ProductRisk | null; tags: string[]; createdAt: string }
interface LogRec extends LogDetail {}
interface State {
  v: 1; releaseNo: number; releases: Release[]; docs: DocMeta[]; versions: DocVersion[];
  logs: LogRec[]; alerts: Alert[]; gaps: Gap[]; tickets: Ticket[];
}
const KEY = 'zhijie.local.v2';
let state: State | null = null;
let chunkCache: Chunk[] | null = null;

const now = () => new Date().toISOString();
const rid = (p: string) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* 存储不可用时仅内存 */ }
}
function load(): State | null {
  try { const s = localStorage.getItem(KEY); return s ? (JSON.parse(s) as State) : null; } catch { return null; }
}

function bundleDocs(): { meta: DocMeta; content: string; version: number }[] {
  const b: any = bundleRaw;
  const docs: any[] = Array.isArray(b?.docs) ? b.docs : [];
  if (docs.length) {
    return docs.map((d) => ({
      meta: {
        docKey: d.docKey ?? d.doc_key, title: d.title, category: d.category, productRisk: (d.productRisk ?? d.product_risk ?? null) || null,
        tags: Array.isArray(d.tags) ? d.tags : [], createdAt: now(),
      },
      content: parseFrontMatter(String(d.content ?? d.body ?? '')).body.trim(), version: Number(d.version ?? 1),
    }));
  }
  return SAMPLE_DOCS.map((d) => ({ meta: { ...d, productRisk: d.productRisk as ProductRisk | null, createdAt: now() }, content: d.content, version: 1 }));
}

function fresh(): State {
  const docs = bundleDocs();
  const ts = now();
  const versions: DocVersion[] = docs.map((d) => ({
    id: rid('dv'), docKey: d.meta.docKey, version: d.version, content: d.content, changeNote: '初始导入', author: '系统',
    status: 'published', gapId: null, createdAt: ts, publishedAt: ts,
  }));
  const rel = String((bundleRaw as any)?.release ?? 'v1');
  return {
    v: 1, releaseNo: Number(rel.replace(/\D/g, '')) || 1,
    releases: [{ id: rid('rel'), releaseNo: rel, note: '初始知识库', docVersions: versions.map((v) => `${v.docKey}@v${v.version}`), createdAt: ts, createdBy: '系统' }],
    docs: docs.map((d) => d.meta), versions, logs: [], alerts: [], gaps: [], tickets: [],
  };
}

const S = () => state!;
const currentRelease = () => S().releases[0]?.releaseNo ?? 'v1';

function activeChunks(): Chunk[] {
  if (chunkCache) return chunkCache;
  const b: any = bundleRaw;
  const pub = S().versions.filter((v) => v.status === 'published');
  const out: Chunk[] = [];
  for (const v of pub) {
    const meta = S().docs.find((d) => d.docKey === v.docKey);
    if (!meta) continue;
    // bundle 自带的块（含 build-kb 的切分结果）优先用于 bundle 原始版本
    const pre = Array.isArray(b?.chunks) ? (b.chunks as Chunk[]).filter((c) => c.docKey === v.docKey && c.version === v.version) : [];
    out.push(...(pre.length && v.author === '系统' ? pre : chunkDoc({ docKey: v.docKey, title: meta.title, version: v.version, content: v.content, category: meta.category, productRisk: meta.productRisk })));
  }
  chunkCache = out;
  return out;
}

/* ---------- 缺口归并（core/gaps：归一化 + 字二元组 Jaccard ≥ 0.5） ---------- */
function recordGap(question: string, type: Gap['type']) {
  const open = S().gaps.filter((x) => x.status !== 'resolved' && x.status !== 'ignored');
  const g = findMergeTarget(question, open);
  const ts = now();
  if (g) {
    g.count++; g.lastSeen = ts;
    if (!g.questions.includes(question)) g.questions.push(question);
    if (type === 'bad_feedback' && g.type !== 'bad_feedback') g.type = type;
  } else {
    S().gaps.unshift({ id: rid('gap'), normKey: normalizeQuestion(question), sampleQuestion: question, questions: [question], count: 1, type, status: 'open', docKey: null, resolvedRelease: null, firstSeen: ts, lastSeen: ts, draftVersionId: null });
  }
}

/* ---------- 一次问答（含落库） ---------- */
/** sideEffects=false：只记日志（评测用），不生成工单/告警/缺口 */
async function chatAndLog(req: ChatRequest, opts: { persist?: boolean; sideEffects?: boolean } = {}): Promise<ChatResponse> {
  const id = rid('qa');
  const resp = await runChat(req, activeChunks(), currentRelease(), id);
  if (opts.persist === false) return resp;
  const ts = now();
  const fx = opts.sideEffects !== false;
  if (fx && resp.handoff) {
    const tid = resp.handoff.ticketId ?? rid('tk');
    resp.handoff = { ...resp.handoff, ticketId: tid };
    S().tickets.unshift({ id: tid, qaId: id, reason: resp.handoff.reason, status: 'pending', assignee: null, reply: null, createdAt: ts, updatedAt: ts, question: req.question });
  }
  for (const h of fx ? resp.compliance : []) {
    if (h.category === 'complaint_human') continue;
    S().alerts.unshift({ id: rid('al'), ts, qaId: id, category: h.category, severity: h.severity, stage: h.stage, matched: h.matched, question: req.question, status: 'open', handledBy: null, handledAt: null });
  }
  if (fx && resp.decision === 'handoff_unknown') recordGap(req.question, 'unknown');
  if (fx && resp.decision === 'handoff_low_conf') recordGap(req.question, 'low_conf');
  S().logs.unshift({
    id, ts, sessionId: req.sessionId, question: req.question, userRisk: req.userRisk, decision: resp.decision, confidence: resp.confidence,
    answer: resp.answer, kbRelease: resp.kbRelease, mode: resp.mode, latencyMs: resp.latencyMs, feedback: null, feedbackNote: null, response: resp,
  });
  if (S().logs.length > 500) S().logs.length = 500;
  save();
  return resp;
}

let ready: Promise<void> | null = null;
function ensure(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      const s = load();
      if (s && s.v === 1) { state = s; return; }
      state = fresh();
      for (const q of SEED_QUESTIONS) await chatAndLog({ ...q, sessionId: 'seed' });
      save();
    })();
  }
  return ready;
}

export function resetLocal() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  state = null; chunkCache = null; ready = null;
}

/* ---------- 发布 ---------- */
function makeRelease(publishVersions: DocVersion[], note: string): Release {
  const ts = now();
  for (const v of publishVersions) {
    for (const o of S().versions) if (o.docKey === v.docKey && o.status === 'published') o.status = 'archived';
    v.status = 'published'; v.publishedAt = ts;
  }
  S().releaseNo++;
  const rel: Release = {
    id: rid('rel'), releaseNo: `v${S().releaseNo}`, note, createdAt: ts, createdBy: '运营（演示）',
    docVersions: S().versions.filter((v) => v.status === 'published').map((v) => `${v.docKey}@v${v.version}`),
  };
  S().releases.unshift(rel);
  chunkCache = null;
  save();
  return rel;
}

function docRow(m: DocMeta): KbDoc {
  const vs = S().versions.filter((v) => v.docKey === m.docKey);
  const pub = vs.find((v) => v.status === 'published');
  const chunks = pub ? activeChunks().filter((c) => c.docKey === m.docKey).length : 0;
  const latest = vs.reduce((a, v) => (v.createdAt > a ? v.createdAt : a), m.createdAt);
  return { docKey: m.docKey, title: m.title, category: m.category, productRisk: m.productRisk, tags: m.tags, currentVersion: pub?.version ?? null, chunks, updatedAt: latest, draftCount: vs.filter((v) => v.status === 'draft').length };
}

const DECISIONS_HANDOFF = (d: string) => d.startsWith('handoff');

export const localApi: ApiClient = {
  async health() { await ensure(); return { ok: true, kbRelease: currentRelease(), chunks: activeChunks().length, ai: false }; },
  async chat(req) { await ensure(); return chatAndLog(req); },
  async feedback(qaId, helpful, note) {
    await ensure();
    const l = S().logs.find((x) => x.id === qaId);
    if (l) { l.feedback = helpful ? 1 : -1; l.feedbackNote = note ?? null; if (!helpful) recordGap(l.question, 'bad_feedback'); save(); }
  },
  async logs(p = {}) {
    await ensure();
    let r = S().logs;
    if (p.decision) r = r.filter((l) => (p.decision === 'handoff' ? DECISIONS_HANDOFF(l.decision) : l.decision === p.decision));
    if (p.q) r = r.filter((l) => l.question.includes(p.q!) || l.id.includes(p.q!));
    return r.slice(0, p.limit ?? 200).map(({ response: _r, ...rest }) => ({ ...rest }));
  },
  async log(id) {
    await ensure();
    const l = S().logs.find((x) => x.id === id);
    if (!l) throw new Error('未找到该条日志（本地演示数据存在当前浏览器）');
    return l;
  },
  async dashboard(): Promise<Dashboard> {
    await ensure();
    const logs = S().logs;
    const total = logs.length;
    const dist = new Map<string, number>();
    logs.forEach((l) => dist.set(l.decision, (dist.get(l.decision) ?? 0) + 1));
    const handoff = logs.filter((l) => DECISIONS_HANDOFF(l.decision)).length;
    const cat = new Map<string, number>();
    S().alerts.forEach((a) => cat.set(a.category, (cat.get(a.category) ?? 0) + 1));
    const days: Dashboard['daily'] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10);
      days.push({ date: d, count: logs.filter((l) => l.ts.slice(0, 10) === d).length });
    }
    return {
      total, autoResolveRate: total ? 1 - handoff / total : 0, handoffRate: total ? handoff / total : 0,
      blockedCount: logs.filter((l) => l.decision === 'refused' || l.decision === 'partial_refusal').length,
      avgConfidence: total ? logs.reduce((s, l) => s + l.confidence, 0) / total : 0,
      openGaps: S().gaps.filter((g) => g.status === 'open' || g.status === 'drafting').length,
      openAlerts: S().alerts.filter((a) => a.status === 'open').length,
      decisionDist: [...dist].map(([decision, count]) => ({ decision: decision as any, count })).sort((a, b) => b.count - a.count),
      topUnanswered: S().gaps.filter((g) => g.status !== 'resolved' && g.status !== 'ignored').sort((a, b) => b.count - a.count).slice(0, 5).map((g) => ({ question: g.sampleQuestion, count: g.count })),
      topViolations: [...cat].map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count).slice(0, 6),
      daily: days, kbRelease: currentRelease(),
    };
  },
  async gaps(status) { await ensure(); return S().gaps.filter((g) => !status || g.status === status); },
  async gapAction(id, action) {
    await ensure();
    const g = S().gaps.find((x) => x.id === id);
    if (!g) throw new Error('缺口不存在');
    if (action === 'ignore') { g.status = 'ignored'; save(); return null; }
    const docKey = g.docKey ?? `faq-${g.id.slice(-6)}`;
    if (!S().docs.find((d) => d.docKey === docKey)) {
      S().docs.push({ docKey, title: `补充问答：${g.sampleQuestion.slice(0, 20)}`, category: 'investor_edu', productRisk: null, tags: ['缺口补充'], createdAt: now() });
    }
    const content = `## ${g.sampleQuestion.replace(/[？?]$/, '')}\n（请依据公开监管规则/交易所规则撰写答案，拿不准的写“以官方最新规则为准”。）\n`;
    const prev = S().versions.filter((v) => v.docKey === docKey);
    const v: DocVersion = { id: rid('dv'), docKey, version: Math.max(0, ...prev.map((x) => x.version)) + 1, content, changeNote: `补充缺口：${g.sampleQuestion}`, author: '运营（演示）', status: 'draft', gapId: g.id, createdAt: now(), publishedAt: null };
    S().versions.push(v);
    g.status = 'drafting'; g.docKey = docKey; g.draftVersionId = v.id;
    save();
    return { docVersionId: v.id, docKey };
  },
  async gapVerify(id) {
    await ensure();
    const g = S().gaps.find((x) => x.id === id);
    if (!g) throw new Error('缺口不存在');
    const results = [];
    for (const q of g.questions) {
      const r = await runChat({ question: q, userRisk: 'C3', sessionId: 'verify' }, activeChunks(), currentRelease(), rid('qa'));
      results.push({ question: q, decision: r.decision, confidence: r.confidence, qaId: null });
    }
    const resolved = results.every((r) => !DECISIONS_HANDOFF(r.decision));
    if (resolved) { g.status = 'resolved'; g.resolvedRelease = currentRelease(); }
    save();
    return { resolved, release: currentRelease(), results };
  },
  async alerts(status) { await ensure(); return S().alerts.filter((a) => !status || a.status === status); },
  async ackAlert(id) {
    await ensure();
    const a = S().alerts.find((x) => x.id === id);
    if (a) { a.status = 'ack'; a.handledBy = '运营（演示）'; a.handledAt = now(); save(); }
  },
  async tickets() { await ensure(); return S().tickets; },
  async updateTicket(id, body) {
    await ensure();
    const t = S().tickets.find((x) => x.id === id);
    if (t) { t.status = body.status; if (body.reply !== undefined) t.reply = body.reply; t.assignee = t.assignee ?? '运营（演示）'; t.updatedAt = now(); save(); }
  },
  async docs() { await ensure(); return S().docs.map(docRow); },
  async doc(docKey) {
    await ensure();
    const m = S().docs.find((d) => d.docKey === docKey);
    if (!m) throw new Error('文档不存在');
    return { doc: docRow(m), versions: S().versions.filter((v) => v.docKey === docKey).sort((a, b) => b.version - a.version) };
  },
  async saveDoc(input: DocInput) {
    await ensure();
    const docKey = input.docKey || 'doc-' + Date.now().toString(36);
    let m = S().docs.find((d) => d.docKey === docKey);
    if (!m) { m = { docKey, title: input.title, category: input.category, productRisk: input.productRisk, tags: input.tags, createdAt: now() }; S().docs.push(m); }
    else Object.assign(m, { title: input.title, category: input.category, productRisk: input.productRisk, tags: input.tags });
    const prev = S().versions.filter((v) => v.docKey === docKey);
    const v: DocVersion = { id: rid('dv'), docKey, version: Math.max(0, ...prev.map((x) => x.version)) + 1, content: input.content, changeNote: input.changeNote, author: '运营（演示）', status: 'draft', gapId: input.gapId ?? null, createdAt: now(), publishedAt: null };
    S().versions.push(v);
    if (input.gapId) { const g = S().gaps.find((x) => x.id === input.gapId); if (g) g.draftVersionId = v.id; }
    save();
    return v;
  },
  async publish(versionIds, note) {
    await ensure();
    const vs = S().versions.filter((v) => versionIds.includes(v.id) && v.status === 'draft');
    if (!vs.length) throw new Error('请选择至少一个草稿版本');
    return makeRelease(vs, note);
  },
  async rollback(docKey, version) {
    await ensure();
    const src = S().versions.find((v) => v.docKey === docKey && v.version === version);
    if (!src) throw new Error('版本不存在');
    const prev = S().versions.filter((v) => v.docKey === docKey);
    const v: DocVersion = { ...src, id: rid('dv'), version: Math.max(...prev.map((x) => x.version)) + 1, changeNote: `回滚到 v${version}`, author: '运营（演示）', status: 'draft', createdAt: now(), publishedAt: null };
    S().versions.push(v);
    return makeRelease([v], `回滚 ${docKey} 到 v${version}`);
  },
  async releases() { await ensure(); return S().releases; },
  async previewChunks(content): Promise<PreviewChunk[]> {
    return chunkDoc({ docKey: 'preview', title: '预览', version: 0, content, category: 'investor_edu', productRisk: null }).map((c) => ({ ord: c.ord, heading: c.heading, text: c.text }));
  },
  async runEval(ids): Promise<EvalRun> {
    await ensure();
    let qs = evalQuestionsRaw as unknown as EvalQuestion[];
    if (ids?.length) qs = qs.filter((q) => ids.includes(q.id));
    const results = [];
    for (const q of qs) {
      try {
        const r = await chatAndLog({ question: q.question, userRisk: q.userRisk ?? 'C3', sessionId: 'eval' }, { sideEffects: false });
        results.push(judge(q, r));
      } catch (e: any) { results.push(judge(q, null, e?.message)); }
    }
    const sum = summarize(results, currentRelease());
    return { ...sum, results: sum.results.map((r) => ({ ...r, actual: { decision: r.actual.decision, citedDocKeys: r.actual.citedDocKeys, alerts: r.actual.alerts, answer: r.actual.answer, confidence: r.actual.confidence } })) } as EvalRun;
  },
};
