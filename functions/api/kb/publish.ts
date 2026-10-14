// POST /api/kb/publish {versionIds:[], note} → 切分 + embedding + 新 release；旧版本 archived、旧块 active=0
import type { Env } from '../../_lib/env';
import { parseFaults } from '../../_lib/env';
import { camel, json, readJson } from '../../_lib/http';
import { publishVersions } from '../../_lib/db';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const b = await readJson<{ versionIds?: string[]; note?: string; by?: string }>(request);
  const ids = Array.isArray(b.versionIds) ? b.versionIds.map(String) : [];
  const r = await publishVersions(env, env.DB, ids, String(b.note ?? ''), b.by ?? '运营', parseFaults(request));
  return json({ ...camel(r.release), release: camel(r.release), chunks: r.chunks, published: r.published });
};
