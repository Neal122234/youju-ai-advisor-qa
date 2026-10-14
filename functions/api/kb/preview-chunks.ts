// POST /api/kb/preview-chunks {content, docKey?, title?} → 切分预览（不落库）
import type { Env } from '../../_lib/env';
import { json, readJson } from '../../_lib/http';
import { chunkDocument } from '../../../core/chunk';

export const onRequestPost: PagesFunction<Env> = async ({ request }) => {
  const b = await readJson<{ content?: string; docKey?: string; title?: string; version?: number }>(request);
  const chunks = chunkDocument(String(b.content ?? ''), { docKey: b.docKey || undefined, title: b.title || undefined, version: Number(b.version) || 1 });
  return json({ chunks: chunks.map((c) => ({ id: c.id, ord: c.ord, heading: c.heading, text: c.text, chars: c.text.length })) });
};
