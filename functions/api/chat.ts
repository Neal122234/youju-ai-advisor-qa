// POST /api/chat  ChatRequest → ChatResponse；支持 x-fault: llm | embed | db | slow-llm（逗号分隔可组合）
import type { Env } from '../_lib/env';
import { parseFaults } from '../_lib/env';
import { HttpError, json, readJson } from '../_lib/http';
import { answer } from '../_lib/chat';
import type { ChatRequest, RiskLevel } from '../../core/types';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const body = await readJson<Partial<ChatRequest>>(request);
  if (typeof body.question !== 'string' || !body.question.trim()) throw new HttpError(400, 'BAD_INPUT', 'question 不能为空');
  if (body.question.length > 5000) throw new HttpError(413, 'TOO_LONG', '问题过长');
  const req: ChatRequest = {
    question: body.question,
    // 小写等变体由管线规范化并记 check；这里原样透传
    userRisk: (typeof body.userRisk === 'string' ? body.userRisk : String(body.userRisk ?? '')) as RiskLevel,
    sessionId: typeof body.sessionId === 'string' ? body.sessionId.slice(0, 64) : '',
    history: Array.isArray(body.history) ? body.history.filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string').slice(-6) : undefined,
  };
  const resp = await answer(env, req, parseFaults(request));
  return json(resp);
};
