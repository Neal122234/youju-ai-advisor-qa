// Worker 侧环境类型。AI 用最小接口描述，避免绑定具体 workers-types 版本的模型重载。
export interface AiBinding { run(model: string, inputs: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown> }
export interface Env {
  DB: D1Database;
  AI?: AiBinding;
  ADMIN_TOKEN?: string;
  /** 仅本地：'1' 且未绑定 AI 时启用确定性替身（functions/_lib/mockAi.ts） */
  MOCK_AI?: string;
}
export type Fault = 'llm' | 'embed' | 'db' | 'slow-llm';
export function parseFaults(req: Request): Set<Fault> {
  const raw = (req.headers.get('x-fault') ?? '').toLowerCase();
  const ok: Fault[] = ['llm', 'embed', 'db', 'slow-llm'];
  return new Set(raw.split(/[\s,]+/).filter((x): x is Fault => (ok as string[]).includes(x)));
}
