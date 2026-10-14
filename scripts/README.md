# scripts 与后端联调说明

## build-kb.ts

```bash
npm run build:kb                          # kb/*.md → web/src/generated/kb-bundle.json + db/seed-meta.json
npx tsx scripts/build-kb.ts tests/fixtures/kb   # 用测试样例目录构建（联调用，会覆盖 bundle）
```

产物：
- `web/src/generated/kb-bundle.json`：`{release:'v1', docs:[{docKey,title,category,productRisk,tags,version,content(含 front-matter 原文)}], chunks:[不含 embedding]}`，浏览器本地模式与 `/api/admin/seed` 共用。
- `db/seed-meta.json`：文档数、块数、块长统计、doc_key 列表、格式告警（缺 doc_key、category 不在枚举、没有 `## ` 小标题等）。
- `functions/_generated/schema.ts`：`db/schema.sql` 的字符串副本，seed 首次调用时自动建表。

## 初始化 D1（/api/admin/seed）

选型：**HTTP 分批 seed**，而不是在本地脚本里 `wrangler d1 execute` 写入。原因：bge-m3 向量只能经 AI binding 计算，本地脚本拿不到 binding（要另配 API Token）；放在 Functions 里可以直接用 `env.AI`，且 SQL 全部 `INSERT OR IGNORE`、向量只补 `embedding IS NULL` 的块，可重复调用。

Pages Functions 免费计划单请求有 CPU 时间与子请求数限制，所以提供分批模式：每次只向量化 50 块（bge-m3 单次上限约 100 条，留余量），响应给出 `nextBatch`，直到 `done:true`。

```bash
# 本地（wrangler pages dev，未设 ADMIN_TOKEN 时只允许 localhost）——一次性完成
curl -X POST http://localhost:8788/api/admin/seed

# 线上：先设置密钥 ADMIN_TOKEN，再按批调用直到 done=true
B=0; while [ "$B" != "null" ]; do
  R=$(curl -s -X POST "https://<站点>/api/admin/seed?batch=$B" -H "x-admin-token: $ADMIN_TOKEN"); echo "$R"
  B=$(echo "$R" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("nextBatch"))')
done

# 清空所有业务表后重建（演示数据重置）
curl -X POST "http://localhost:8788/api/admin/seed?reset=1"
```

未绑定 AI 时 seed 只导入文档与块（不向量化），检索自动走关键词模式；绑定 AI 后再调用一次即可补齐向量。

## 本地联调

```bash
npm run build:kb
npx wrangler d1 execute zhijie-qa --local --file db/schema.sql   # 可选，seed 也会自动建表
npx wrangler pages dev dist --d1 DB --ai AI                     # AI 走远程，需要账号已注册 workers.dev 子域
```

如果 `--ai AI` 报 "You need to register a workers.dev subdomain"，可以先不绑定真实 AI，用确定性替身跑通全链路（仅本地，绑定了真实 AI 时永不启用）：

```bash
# 需要一个不含 [ai] 的 wrangler.toml（项目根的 toml 带 [ai]，pages dev 会强制走远程）
npx wrangler pages dev dist --d1 DB -b MOCK_AI=1
```

`/api/health` 的 `aiMode` 字段会显示 `workers-ai | mock | none`；mock 模式下 `model` 字段为 `mock(@cf/qwen/...)`。

## 故障注入（x-fault 头，可逗号组合）

| 值 | 效果 | 预期 |
|---|---|---|
| `llm` | 主模型与备用模型都抛错 | `decision=degraded`，按 top2 原文抽取作答，仍做输入/输出合规 |
| `slow-llm` | 模型调用挂起超过 12s 预算 | 12s 超时 → `degraded`（超时不再回退备用模型，避免总延迟翻倍） |
| `embed` | bge-m3 抛错 | 检索降级为 BM25 关键词模式，`checks.retrieval` 记录原因；发布时整体不发布（502） |
| `db` | 所有 D1 调用抛错 | 检索回退内置 kb-bundle；落库失败只记 `checks.persistence`，chat 照常返回；工单号显示"暂未生成" |

## 限流与缓存的取舍

- 限流：isolate 内存 Map 固定窗口（chat 每 IP 每分钟 20 次，其他接口 120 次）。零 D1 写入、不受 `x-fault: db` 影响；代价是各 isolate 独立计数，不是全局精确限额。生产应换 Rate Limiting binding / Durable Object。
- 结果缓存：同问题（归一化）+ 同 release + 同 userRisk，10 分钟。先查 isolate 内存，再查 Cache API。只缓存真正调用了 LLM 且非转人工的结果；带 history 或 x-fault 的请求不走缓存。发布新 release 后 key 自然失效。

## 预计算向量（export-embeddings）

`/api/admin/seed?reset=1` 会清空向量，重新向量化 181 块要消耗 Workers AI 当日额度（免费计划每日 10,000 neurons）。额度用完时，reset 后线上只能走关键词检索。为此把向量导出成文件随代码发布：

```bash
npx tsx scripts/export-embeddings.ts          # 从远程 D1 只读查询 chunks.embedding（不调用 AI），写 db/embeddings.v1.json
npx tsx scripts/export-embeddings.ts --local  # 本地 D1
npm run build:kb                              # 把它复制成 functions/_generated/embeddings.json（随 Functions 打包）
```

seed 时对每个待向量化的块，先查预计算表：块 id 相同，且内容指纹（heading+text 的 FNV-1a）一致，就直接写库，不调用 AI；只有缺失或内容已改的块才调用 bge-m3。响应里的 `fromPrecomputed` / `fromAi` 分别是两种来源的块数。没有绑定 AI 时，也能用预计算向量完成 seed。

存储格式取舍：每个分量用 float16 存，整条向量按 base64 编码（1024 维约 2.7 KB/块，181 块约 500 KB），体积约为 JSON 浮点的 1/3。bge-m3 的输出已做 L2 归一化，float16 的有效精度约为 3 位十进制，余弦相似度误差在 1e-3 量级（见 `tests/embeddings.test.ts`），对 top-k 排序没有实际影响。写入 D1 时仍解码为 JSON 浮点，不改变 `chunks.embedding` 的格式。
