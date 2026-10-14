// 仅本地联调用的确定性 AI 替身（wrangler pages dev ... -b MOCK_AI=1，且未绑定真实 AI 时生效）。
// 生产环境绑定了 AI 时永不启用。embedding：字二元组哈希到 1024 维；LLM：取【资料】[1] 前两句并按 JSON 协议输出。
import { charBigramSet } from '../../core/tokenize';
import type { AiBinding } from './env';

function hashVec(text: string): number[] {
  const v = new Array(1024).fill(0);
  for (const b of charBigramSet(text)) {
    let h = 2166136261;
    for (let i = 0; i < b.length; i++) { h ^= b.charCodeAt(i); h = Math.imul(h, 16777619); }
    v[(h >>> 0) % 1024] += 1;
  }
  const n = Math.sqrt(v.reduce((a, x) => a + x * x, 0)) || 1;
  return v.map((x) => x / n);
}

export const mockAi: AiBinding = {
  async run(model, inputs) {
    if (model.includes('bge')) return { data: (inputs.text as string[]).map(hashVec), shape: [(inputs.text as string[]).length, 1024] };
    const msgs = (inputs.messages ?? inputs.input) as { role: string; content: string }[];
    const user = msgs.filter((m) => m.role === 'user').map((m) => m.content).join('\n');
    const m = user.match(/\[1\][^\n]*\n([^\n]+)/);
    if (!m) return { response: '{"answer":"NO_ANSWER","used":[],"covered":false}' };
    const sents = m[1].split(/(?<=[。！？])/).filter(Boolean).slice(0, 2);
    const answer = sents.map((s) => s.replace(/[。！？]$/, '') + '[1]。').join('');
    // 模拟 qwen3 OpenAI 兼容格式 + <think> 前缀
    return { choices: [{ message: { content: `<think>mock</think>{"answer":${JSON.stringify(answer)},"used":[1],"covered":true}` } }] };
  },
};
