/// <reference types="node" />
// kb/*.md → web/src/generated/kb-bundle.json（本地演示模式 + /api/admin/seed 共用）与 db/seed-meta.json
// 用法：npm run build:kb            （默认读 kb/）
//       npx tsx scripts/build-kb.ts tests/fixtures/kb   （指定目录，联调样例用）
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chunkDocument, normalizeMeta, parseFrontMatter } from '../core/chunk';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const KB_DIR = resolve(ROOT, process.argv[2] ?? 'kb');
const OUT = join(ROOT, 'web/src/generated/kb-bundle.json');
const META_OUT = join(ROOT, 'db/seed-meta.json');
const CATEGORIES = new Set(['product_rule', 'market_basics', 'investor_edu', 'compliance_script', 'suitability']);

const files = readdirSync(KB_DIR).filter((f) => f.endsWith('.md') && !/^readme/i.test(f)).sort();
const docs: any[] = []; const chunks: any[] = []; const warnings: string[] = [];
const seen = new Set<string>();
for (const f of files) {
  const raw = readFileSync(join(KB_DIR, f), 'utf8').replace(/\r\n?/g, '\n');
  const { meta: fm, body } = parseFrontMatter(raw);
  const meta = normalizeMeta(fm, basename(f, '.md'));
  if (!fm.doc_key) warnings.push(`${f}: 缺少 doc_key，使用文件名`);
  if (seen.has(meta.doc_key)) { warnings.push(`${f}: doc_key 重复 ${meta.doc_key}，已跳过`); continue; }
  seen.add(meta.doc_key);
  if (!CATEGORIES.has(meta.category)) warnings.push(`${f}: category=${meta.category} 不在约定枚举内`);
  if (!/^##\s/m.test(body)) warnings.push(`${f}: 没有 "## " 小标题`);
  const cs = chunkDocument(raw, { docKey: meta.doc_key, title: meta.title, version: 1, category: meta.category, productRisk: meta.product_risk });
  docs.push({ docKey: meta.doc_key, title: meta.title, category: meta.category, productRisk: meta.product_risk, tags: meta.tags,
    source: meta.source ?? null, effectiveDate: meta.effective_date ?? null, version: 1, content: raw });
  chunks.push(...cs);
}
const bundle = { release: 'v1', generatedAt: new Date().toISOString(), docs, chunks };
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(bundle));
const lens = chunks.map((c) => c.text.length);
const meta = { release: 'v1', source: KB_DIR.replace(ROOT + '/', ''), generatedAt: bundle.generatedAt, docs: docs.length, chunks: chunks.length,
  maxChunkChars: Math.max(0, ...lens), avgChunkChars: lens.length ? Math.round(lens.reduce((a, b) => a + b, 0) / lens.length) : 0,
  docKeys: docs.map((d) => d.docKey), warnings };
mkdirSync(dirname(META_OUT), { recursive: true });
writeFileSync(META_OUT, JSON.stringify(meta, null, 2) + '\n');
// db/schema.sql → functions/_generated/schema.ts（/api/admin/seed 首次调用时自动建表）
const schema = readFileSync(join(ROOT, 'db/schema.sql'), 'utf8');
mkdirSync(join(ROOT, 'functions/_generated'), { recursive: true });
writeFileSync(join(ROOT, 'functions/_generated/schema.ts'), `// 由 scripts/build-kb.ts 从 db/schema.sql 生成，勿手改\nexport const SCHEMA_SQL = ${JSON.stringify(schema)};\n`);
console.log(`kb-bundle: ${docs.length} docs, ${chunks.length} chunks (avg ${meta.avgChunkChars} 字, max ${meta.maxChunkChars} 字) → ${OUT.replace(ROOT + '/', '')}`);
for (const w of warnings) console.warn('  ⚠', w);
