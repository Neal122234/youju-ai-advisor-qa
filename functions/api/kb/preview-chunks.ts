// POST /api/kb/preview-chunks {content, docKey?, title?} → 切分预览（不落库）
import type { Env } from '../../_lib/env';
import { HttpError, json, readJson } from '../../_lib/http';
import { chunkDocument } from '../../../core/chunk';

export const onRequestPost: PagesFunction<Env> = async ({ request }) => {
  const b = await readJson<{ content?: unknown; docKey?: unknown; title?: unknown; version?: unknown }>(request);
  for (const k of ['content', 'docKey', 'title'] as const) if (b[k] !== undefined && b[k] !== null && typeof b[k] !== 'string') throw new HttpError(400, 'BAD_INPUT', `${k} 必须是字符串`);
  const chunks = chunkDocument((b.content as string) ?? '', { docKey: (b.docKey as string) || undefined, title: (b.title as string) || undefined, version: Number(b.version) || 1 });
  return json({ chunks: chunks.map((c) => ({ id: c.id, ord: c.ord, heading: c.heading, text: c.text, chars: c.text.length })) });
};
