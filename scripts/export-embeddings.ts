/// <reference types="node" />
// 从线上 D1 导出已计算的 bge-m3 向量 → db/embeddings.v1.json（chunkId → {fp 内容指纹, v float16 base64}）。
// seed 时优先用这份预计算向量写库，不再依赖 Workers AI 每日额度；只有缺失或内容已变的块才调用 AI。
// 用法：
//   npx tsx scripts/export-embeddings.ts                 # 远程 D1（wrangler 已登录），只读查询，不消耗 AI 额度
//   npx tsx scripts/export-embeddings.ts --local         # 本地 D1（wrangler pages dev 的 .wrangler/state）
//   npx tsx scripts/export-embeddings.ts --from rows.json # 从已导出的查询结果文件转换（测试/离线用）
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chunkFingerprint, encodeF16Base64, type EmbeddingBundle } from '../core/f16';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.EMB_OUT ? resolve(process.env.EMB_OUT) : join(ROOT, 'db/embeddings.v1.json');
const DB_NAME = 'zhijie-qa';
const PAGE = 40;   // 每页 40 行（每行向量 JSON 约 9KB），避免单次输出过大

type Row = { id: string; heading: string; text: string; embedding: string | null };

function queryPage(offset: number, local: boolean): Row[] {
  const sql = `SELECT id, heading, text, embedding FROM chunks WHERE active = 1 AND embedding IS NOT NULL ORDER BY id LIMIT ${PAGE} OFFSET ${offset}`;
  const out = execFileSync('npx', ['wrangler', 'd1', 'execute', DB_NAME, local ? '--local' : '--remote', '--json', '--command', sql], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const i = out.indexOf('[');
  const parsed = JSON.parse(out.slice(i));
  return (parsed[0]?.results ?? []) as Row[];
}

export function buildBundle(rows: Row[], source: string): EmbeddingBundle {
  const chunks: EmbeddingBundle['chunks'] = {};
  let dims = 0;
  for (const r of rows) {
    if (!r.embedding) continue;
    const vec = JSON.parse(r.embedding) as number[];
    if (!Array.isArray(vec) || !vec.length) continue;
    dims = vec.length;
    chunks[r.id] = { fp: chunkFingerprint(r.heading, r.text), v: encodeF16Base64(vec) };
  }
  return { model: '@cf/baai/bge-m3', dims, format: 'f16-base64', exportedAt: new Date().toISOString(), source, chunks };
}

function main() {
  const args = process.argv.slice(2);
  const fromIdx = args.indexOf('--from');
  let rows: Row[] = [];
  let source = 'd1-remote';
  if (fromIdx >= 0) {
    const f = args[fromIdx + 1];
    const parsed = JSON.parse(readFileSync(resolve(f), 'utf8'));
    // 支持 wrangler --json 的原始输出（[{results:[…]}]）、{results:[…]} 或行数组
    rows = Array.isArray(parsed) ? (parsed[0]?.results ?? parsed) : (parsed.results ?? []);
    source = `file:${f}`;
  } else {
    const local = args.includes('--local');
    source = local ? 'd1-local' : 'd1-remote';
    for (let off = 0; ; off += PAGE) {
      const page = queryPage(off, local);
      rows.push(...page);
      process.stdout.write(`  已读取 ${rows.length} 行\r`);
      if (page.length < PAGE) break;
    }
  }
  const bundle = buildBundle(rows, source);
  const n = Object.keys(bundle.chunks).length;
  if (!n) { console.error('没有可导出的向量（线上可能尚未 seed 出向量），未写文件'); process.exit(1); }
  writeFileSync(OUT, JSON.stringify(bundle));
  const kb = Math.round(readFileSync(OUT).length / 1024);
  console.log(`\n导出 ${n} 块向量（${bundle.dims} 维，float16+base64）→ ${OUT.replace(ROOT + '/', '')}（${kb} KB）`);
  console.log('下一步：npm run build:kb（会把它带进 functions/_generated/embeddings.json），再部署；之后 /api/admin/seed 优先用预计算向量。');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
