// 无依赖的小工具（供 pipeline 与 intent 共用，避免循环引用）
export function stripThink(s: string): string {
  return (s || '').replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^[\s\S]*?<\/think>/i, '').trim();
}
