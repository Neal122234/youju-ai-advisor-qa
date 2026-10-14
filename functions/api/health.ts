import type { Env } from '../_lib/env';
import { json } from '../_lib/http';
import { loadKb } from '../_lib/db';
import { providerOrder, providerState, sfConfigured } from '../_lib/ai';
import { mockAi } from '../_lib/mockAi';

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const kb = await loadKb(env.DB);
  return json({ ok: true, kbRelease: kb.release, chunks: kb.chunks.length, providers: (() => {
    // 不为探测而真实调用模型：只看本 isolate 内最近一次调用结果
    const st = providerState(); const now = Date.now();
    const status = (p: 'workers-ai' | 'siliconflow', present: boolean, presentLabel: string) =>
      !present ? 'missing' : st.quotaUntil[p] > now ? 'quota' : st.lastOk[p] > st.lastQuota[p] ? 'ok' : presentLabel;
    return { order: providerOrder(env), workersAi: status('workers-ai', !!env.AI, 'unknown'), siliconflow: status('siliconflow', sfConfigured(env), 'configured') };
  })(), ai: !!env.AI, aiMode: !env.AI ? 'none' : env.MOCK_AI === '1' && (env.AI as unknown) === mockAi ? 'mock' : 'workers-ai', db: kb.source === 'd1', embedded: kb.embedded, seeded: kb.source === 'd1', note: kb.note || undefined });
};
