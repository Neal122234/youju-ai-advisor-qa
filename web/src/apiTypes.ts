// 运营后台接口的前端类型（camelCase）。线上接口返回的 snake_case 行由 api.ts 统一归一化成这些形状。
import type { ChatResponse, Decision, RiskLevel, ProductRisk, ComplianceCategory } from '../../core/types';

export type { ChatResponse, Decision, RiskLevel, ProductRisk, ComplianceCategory };
export type { Citation, ChatRequest, ComplianceHit, CheckResult, Chunk, Retrieved } from '../../core/types';

export interface Health { ok: boolean; kbRelease: string; chunks: number; ai: boolean }

export interface LogItem {
  id: string; ts: string; sessionId: string; question: string; userRisk: RiskLevel;
  decision: Decision; confidence: number; answer: string; kbRelease: string;
  mode: string; latencyMs: number; feedback: number | null; feedbackNote: string | null;
}
export interface LogDetail extends LogItem { response: ChatResponse | null }

export interface Dashboard {
  total: number; autoResolveRate: number; handoffRate: number; blockedCount: number;
  avgConfidence: number; openGaps: number; openAlerts: number;
  decisionDist: { decision: Decision; count: number }[];
  topUnanswered: { question: string; count: number }[];
  topViolations: { category: string; count: number }[];
  daily: { date: string; count: number }[];
  kbRelease: string;
}

export type GapType = 'unknown' | 'low_conf' | 'bad_feedback' | 'wrong_answer';
export type GapStatus = 'open' | 'drafting' | 'resolved' | 'ignored';
export interface Gap {
  id: string; normKey: string; sampleQuestion: string; questions: string[]; count: number;
  type: GapType; status: GapStatus; docKey: string | null; resolvedRelease: string | null;
  firstSeen: string; lastSeen: string; draftVersionId: string | null;
}
export interface GapDraftResult { docVersionId: string; docKey: string | null }
export interface GapVerifyResult {
  resolved: boolean; release: string;
  results: { question: string; decision: Decision; confidence: number; qaId: string | null }[];
}

export interface Alert {
  id: string; ts: string; qaId: string | null; category: string; severity: 'high' | 'medium' | 'low';
  stage: 'input' | 'output'; matched: string; question: string; status: 'open' | 'ack';
  handledBy: string | null; handledAt: string | null;
}

export type TicketStatus = 'pending' | 'processing' | 'closed';
export interface Ticket {
  id: string; qaId: string | null; reason: string; status: TicketStatus; assignee: string | null;
  reply: string | null; createdAt: string; updatedAt: string; question: string | null;
}

export interface KbDoc {
  docKey: string; title: string; category: string; productRisk: ProductRisk | null; tags: string[];
  currentVersion: number | null; chunks: number; updatedAt: string; draftCount: number;
}
export type VersionStatus = 'draft' | 'published' | 'archived';
export interface DocVersion {
  id: string; docKey: string; version: number; content: string; changeNote: string; author: string;
  status: VersionStatus; gapId: string | null; createdAt: string; publishedAt: string | null;
}
export interface DocDetail { doc: KbDoc; versions: DocVersion[] }
export interface DocInput {
  docKey?: string; title: string; category: string; productRisk: ProductRisk | null;
  tags: string[]; content: string; changeNote: string; gapId?: string | null;
}
export interface Release { id: string; releaseNo: string; note: string; docVersions: string[]; createdAt: string; createdBy: string }
export interface PreviewChunk { ord: number; heading: string; text: string }

export interface EvalItem {
  id: string; type: string; question: string; userRisk: RiskLevel;
  expect: { decisionIn?: Decision[]; mustCiteDocKeys?: string[]; mustNotContain?: string[]; alert?: string | null };
  actual: { decision: Decision | null; citedDocKeys: string[]; alerts: string[]; answer: string; confidence: number };
  qaId: string | null; pass: boolean; reasons: string[];
}
export interface EvalRun {
  total: number; passed: number; passRate: number; kbRelease: string;
  byType: { type: string; total: number; passed: number }[];
  results: EvalItem[];
}
