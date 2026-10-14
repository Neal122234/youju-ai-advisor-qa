// 核心类型（SPEC §4）。Worker 与浏览器共用，禁止引入任何平台依赖。
export type RiskLevel = 'C1' | 'C2' | 'C3' | 'C4' | 'C5'; // 投资者风险承受等级
export type ProductRisk = 'R1' | 'R2' | 'R3' | 'R4' | 'R5';
export interface Chunk {
  id: string; docKey: string; docTitle: string; version: number; ord: number;
  heading: string; text: string; category: string; productRisk: ProductRisk | null; embedding?: number[];
}
export interface Retrieved { chunk: Chunk; score: number; vec?: number; kw?: number }
export type ComplianceCategory =
  | 'stock_pick'        // 荐股/买卖点/仓位建议
  | 'price_prediction'  // 预测涨跌/目标价/大盘点位
  | 'return_promise'    // 保本保收益/稳赚
  | 'managed_account'   // 代客理财/代操作/索要账户密码
  | 'insider_manip'     // 内幕消息/操纵/荐股群
  | 'privacy'           // 查询他人信息/泄露个人隐私
  | 'prompt_injection'  // 绕过规则、角色扮演越狱
  | 'complaint_human';  // 投诉/要求人工
export interface ComplianceHit { category: ComplianceCategory; severity: 'high' | 'medium' | 'low'; matched: string; stage: 'input' | 'output' }
export type Decision =
  | 'answered'            // 正常作答
  | 'answered_caveat'     // 作答但置信中等，附"建议核实/可转人工"
  | 'partial_refusal'     // 问题部分越界：越界部分拒答、合规部分作答
  | 'refused'             // 整体越界，合规话术拒答 + 告警
  | 'handoff_unknown'     // 知识库无覆盖 → 转人工 + 记缺口
  | 'handoff_low_conf'    // 有召回但置信低 → 转人工 + 记缺口
  | 'handoff_request'     // 用户要求人工/投诉
  | 'degraded';           // LLM 异常，按原文抽取作答（仍做合规）
export interface Citation { n: number; chunkId: string; docKey: string; docTitle: string; version: number; heading: string; snippet: string }
export interface CheckResult { name: string; pass: boolean; detail: string }
export interface ChatRequest { question: string; userRisk: RiskLevel; sessionId: string; history?: { role: 'user' | 'assistant'; content: string }[] }
export interface ChatResponse {
  id: string; decision: Decision; answer: string; citations: Citation[];
  confidence: number;                 // 0..1
  confidenceBreakdown: { retrieval: number; coverage: number; grounding: number; citation: number };
  handoff: null | { reason: string; ticketId: string | null };
  suitability: null | { userRisk: RiskLevel; productRisk: ProductRisk; matched: boolean; notice: string };
  disclaimer: string;                  // 统一风险提示
  compliance: ComplianceHit[];
  checks: CheckResult[];               // 每一步校验的结果（可追溯）
  retrieval: { chunkId: string; docTitle: string; heading: string; score: number }[];
  kbRelease: string;                   // 如 "v3"
  mode: 'llm' | 'degraded' | 'local';
  latencyMs: number; model: string | null;
}

/** 文档元数据（kb/*.md front-matter） */
export interface DocMeta {
  doc_key: string; title: string; category: string; product_risk: ProductRisk | null;
  tags: string[]; source?: string; effective_date?: string; [k: string]: unknown;
}

export type LlmMessage = { role: string; content: string };
export type LlmFn = (messages: LlmMessage[], o?: { maxTokens?: number; json?: boolean; timeoutMs?: number; noFallback?: boolean }) => Promise<string>;

export interface Adapters {
  retrieve(q: string): Promise<{ hits: Retrieved[]; mode: 'hybrid' | 'keyword' }>;
  llm: null | LlmFn;
  kbRelease: string;
  newId(): string;
  /** 可选：llm 实际使用的模型名（由 Worker 适配层回填） */
  modelName?: () => string | null;
  /** 可选：合规话术块（compliance_script 文档），用于拒答模板与引用；缺省用内置副本 */
  scripts?: () => Promise<Chunk[]> | Chunk[];
}

export interface PipelineOptions {
  /** 'server'（默认）：llm 为 null 视为异常 → degraded；'local'：浏览器本地演示模式，抽取式作答 */
  mode?: 'server' | 'local';
  /** 第二层 LLM 意图分类（默认开启；llm=null 时自动跳过） */
  intentLlm?: boolean;
  maxInputLen?: number;          // 默认 500
  tUnknownHybrid?: number;       // 默认 0.35
  tUnknownKeyword?: number;      // 默认 0.25
  minScore?: number;             // 默认 0.2
  topK?: number;                 // 默认 6
  now?: () => number;
}

export class InputError extends Error {
  code = 'BAD_INPUT';
  constructor(message: string) { super(message); }
}
