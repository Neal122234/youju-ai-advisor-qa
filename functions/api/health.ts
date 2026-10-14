import type { Env } from '../_lib/env';
import { json } from '../_lib/http';
import { loadKb } from '../_lib/db';
import { mockAi } from '../_lib/mockAi';

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const kb = await loadKb(env.DB);
  return json({ ok: true, kbRelease: kb.release, chunks: kb.chunks.length, ai: !!env.AI, aiMode: !env.AI ? 'none' : env.MOCK_AI === '1' && (env.AI as unknown) === mockAi ? 'mock' : 'workers-ai', db: kb.source === 'd1', embedded: kb.embedded, seeded: kb.source === 'd1', note: kb.note || undefined });
};
