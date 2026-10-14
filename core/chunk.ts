// 知识库文档解析与切分（SPEC §3）：front-matter → 按 "## " 切 → 单块 >400 字再按句切，块间 overlap 1 句。
import type { Chunk, DocMeta, ProductRisk } from './types';

export const MAX_CHUNK_CHARS = 400;
const RISKS = new Set(['R1', 'R2', 'R3', 'R4', 'R5']);

function parseScalar(raw: string): unknown {
  let v = raw.trim();
  // 去掉行尾注释（不在引号内时）
  if (!/^["']/.test(v)) { const i = v.search(/\s+#/); if (i >= 0) v = v.slice(0, i).trim(); }
  if (v === '' || v === 'null' || v === '~' || v === 'Null' || v === 'NULL') return null;
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^\[.*\]$/.test(v)) {
    return v.slice(1, -1).split(/[,，]/).map((x) => String(parseScalar(x) ?? '').trim()).filter(Boolean);
  }
  if (/^".*"$/.test(v) || /^'.*'$/.test(v)) return v.slice(1, -1);
  if (/^-?\d+(\.\d+)?$/.test(v) && !/^0\d/.test(v)) return Number(v);
  return v;
}

/** 解析 YAML 子集 front-matter（key: value / [a, b] / null / 引号 / 行内注释 / "- item" 列表） */
export function parseFrontMatter(md: string): { meta: Record<string, unknown>; body: string } {
  const text = (md ?? '').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const m = text.match(/^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/);
  if (!m) return { meta: {}, body: text };
  const meta: Record<string, unknown> = {};
  let lastKey: string | null = null;
  for (const line of m[1].split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const item = line.match(/^\s+-\s+(.*)$/);
    if (item && lastKey) {
      const arr = Array.isArray(meta[lastKey]) ? (meta[lastKey] as unknown[]) : [];
      arr.push(parseScalar(item[1])); meta[lastKey] = arr; continue;
    }
    const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (!kv) continue;
    lastKey = kv[1];
    const val = parseScalar(kv[2]);
    meta[kv[1]] = val === null && kv[2].trim() === '' ? [] : val;
  }
  return { meta, body: text.slice(m[0].length) };
}

/** 规范化元数据（缺省值、tags 数组、product_risk 校验） */
export function normalizeMeta(raw: Record<string, unknown>, fallbackKey = 'untitled'): DocMeta {
  const pr = typeof raw.product_risk === 'string' && RISKS.has(raw.product_risk.toUpperCase()) ? (raw.product_risk.toUpperCase() as ProductRisk) : null;
  const tags = Array.isArray(raw.tags) ? raw.tags.map(String) : typeof raw.tags === 'string' ? raw.tags.split(/[,，\s]+/).filter(Boolean) : [];
  return {
    ...raw,
    doc_key: String(raw.doc_key ?? fallbackKey),
    title: String(raw.title ?? raw.doc_key ?? fallbackKey),
    category: String(raw.category ?? 'investor_edu'),
    product_risk: pr,
    tags,
    source: raw.source != null ? String(raw.source) : undefined,
    effective_date: raw.effective_date != null ? String(raw.effective_date) : undefined,
  };
}

/** 生成 front-matter 文本（运营后台编辑保存时用） */
export function buildFrontMatter(meta: DocMeta): string {
  const lines = ['---', `doc_key: ${meta.doc_key}`, `title: ${meta.title}`, `category: ${meta.category}`,
    `product_risk: ${meta.product_risk ?? 'null'}`, `tags: [${meta.tags.join(', ')}]`];
  if (meta.source) lines.push(`source: ${meta.source}`);
  if (meta.effective_date) lines.push(`effective_date: ${meta.effective_date}`);
  lines.push('---');
  return lines.join('\n') + '\n';
}

/** 按句切分（保留句末标点）。 */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  const re = /[^。！？!?；;\n]+[。！？!?；;]*|\n+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) { const s = m[0].trim(); if (s) out.push(s); }
  return out;
}

function packSentences(sents: string[], max: number): string[] {
  const pieces: string[] = [];
  let cur: string[] = [];
  let len = 0;
  for (let i = 0; i < sents.length; i++) {
    const s = sents[i];
    if (len + s.length > max && cur.length) {
      pieces.push(cur.join(''));
      const overlap = cur[cur.length - 1];          // overlap 1 句
      cur = overlap.length + s.length <= max ? [overlap] : [];
      len = cur.reduce((a, b) => a + b.length, 0);
    }
    if (s.length > max) {                            // 极长单句：硬切
      for (let j = 0; j < s.length; j += max) { const part = s.slice(j, j + max); if (cur.length) { pieces.push(cur.join('')); cur = []; len = 0; } pieces.push(part); }
      continue;
    }
    cur.push(s); len += s.length;
  }
  if (cur.length) {
    const last = cur.join('');
    // 末块若只剩 overlap 句则不单独成块
    if (!(pieces.length && cur.length === 1 && pieces[pieces.length - 1].endsWith(last))) pieces.push(last);
  }
  return pieces;
}

export interface ChunkMeta { docKey: string; title: string; version: number; category: string; productRisk: ProductRisk | null }

/**
 * 切分文档。md 可带或不带 front-matter；meta 未给出的字段取 front-matter。
 * chunk id = `${docKey}@v${version}#${ord}`
 */
export function chunkDocument(md: string, meta: Partial<ChunkMeta> = {}): Chunk[] {
  const { meta: fm, body } = parseFrontMatter(md);
  const nm = normalizeMeta(fm, meta.docKey ?? 'untitled');
  const docKey = meta.docKey ?? nm.doc_key;
  const title = meta.title ?? nm.title;
  const version = meta.version ?? 1;
  const category = meta.category ?? nm.category;
  const productRisk = meta.productRisk !== undefined ? meta.productRisk : nm.product_risk;

  const sections: { heading: string; text: string }[] = [];
  let heading = title;
  let buf: string[] = [];
  const push = () => { const t = buf.join('\n').trim(); if (t) sections.push({ heading, text: t }); buf = []; };
  for (const line of body.split('\n')) {
    const h2 = line.match(/^##\s+(.+?)\s*#*\s*$/);
    if (h2 && !line.startsWith('###')) { push(); heading = h2[1].trim(); continue; }
    if (/^#\s+/.test(line)) continue;                  // 一级标题不入正文
    buf.push(line);
  }
  push();

  const chunks: Chunk[] = [];
  let ord = 0;
  for (const sec of sections) {
    const clean = sec.text.replace(/\n{3,}/g, '\n\n');
    const pieces = clean.length > MAX_CHUNK_CHARS ? packSentences(splitSentences(clean), MAX_CHUNK_CHARS) : [clean];
    for (const p of pieces) {
      chunks.push({ id: `${docKey}@v${version}#${ord}`, docKey, docTitle: title, version, ord, heading: sec.heading, text: p, category, productRisk });
      ord++;
    }
  }
  return chunks;
}
