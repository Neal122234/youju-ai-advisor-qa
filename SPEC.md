# 有据 · 投资问答助手 — 工程规格（所有 agent 以此为准）

题目：同花顺笔试第 1 题「AI 投顾/智能问答运营与合规边界」（见 QUESTIONS.md）。**截止 2026-10-15 19:00（北京时间）**。
产品名：**有据**（原名「知界」；定位"投资问题，有据可答"，合规拦截为内置底层规则）。场景：某**匿名券商「示例证券」** App 内的「投教助手」+ 运营后台。不出现任何真实券商/同花顺品牌。

## 1. 技术栈（全部免费）
- Cloudflare Pages（静态 `dist/`）+ Pages Functions（`functions/`）+ D1（binding `DB`）+ Workers AI（binding `AI`）。
- LLM：`@cf/qwen/qwen3-30b-a3b-fp8`（主，≈2s）；`@cf/openai/gpt-oss-120b`（备）。Embedding：`@cf/baai/bge-m3`（1024 维）。
  - Workers AI 返回格式不一：qwen3 走 OpenAI 兼容 `result.choices[0].message.content`，也可能是 `result.response`；可能带 `<think>…</think>`，必须剥掉。两种都要兼容。
- 前端：Vite + React 19 + TS（`web/`，构建到 `dist/`），不引入 UI 库，手写 CSS。
- 镜像：GitHub Pages 上同一前端；API 不可达时切到**本地演示模式**（浏览器内跑 `core/` 管线，无 LLM、无向量，BM25 检索+抽取式回答），界面明确标注。
- 测试：vitest（`tests/`）。

## 2. 目录
```
kb/*.md              知识库源文件（front-matter + 正文），种子数据
eval/questions.json  评测集
core/                纯 TS，无平台依赖；Worker 和浏览器共用
  types.ts chunk.ts tokenize.ts retrieve.ts compliance.ts confidence.ts pipeline.ts templates.ts
functions/api/...    Pages Functions（Worker 侧适配：D1/AI）
functions/_lib/      Worker 侧共享（db.ts ai.ts）
db/schema.sql        D1 表结构
scripts/build-kb.ts  kb/*.md → web/src/generated/kb-bundle.json（本地模式与种子用）
web/                 前端
tests/               vitest
docs/                README 之外的交付文档
```

## 3. 知识库文档格式（kb/*.md）
```
---
doc_key: rule-star-market-access        # 稳定 id，kebab-case
title: 科创板个人投资者权限开通条件
category: product_rule | market_basics | investor_edu | compliance_script | suitability
product_risk: R1..R5 | null             # 涉及某类产品时填，用于适当性比对
tags: [科创板, 权限, 门槛]
source: 公开监管规则整理（脱敏示例）   # 出处说明
effective_date: 2026-01-01
---
## 小标题
正文……
```
切分：按 `##` 小标题切，单块 > 400 字再按句号切，块间 overlap 1 句。chunk id = `${doc_key}@v${version}#${ord}`。

## 4. 核心类型（core/types.ts，必须一致）
```ts
export type RiskLevel = 'C1'|'C2'|'C3'|'C4'|'C5';          // 投资者风险承受等级
export type ProductRisk = 'R1'|'R2'|'R3'|'R4'|'R5';
export interface Chunk { id: string; docKey: string; docTitle: string; version: number; ord: number;
  heading: string; text: string; category: string; productRisk: ProductRisk|null; embedding?: number[] }
export interface Retrieved { chunk: Chunk; score: number; vec?: number; kw?: number }
export type ComplianceCategory =
  | 'stock_pick'        // 荐股/买卖点/仓位建议
  | 'price_prediction'  // 预测涨跌/目标价/大盘点位
  | 'return_promise'    // 保本保收益/稳赚
  | 'managed_account'   // 代客理财/代操作/索要账户密码
  | 'insider_manip'     // 内幕消息/操纵/荐股群
  | 'privacy'           // 查询他人信息/泄露个人隐私
  | 'prompt_injection'  // 绕过规则、角色扮演越狱
  | 'complaint_human';  // 投诉/要求人工
export interface ComplianceHit { category: ComplianceCategory; severity: 'high'|'medium'|'low'; matched: string; stage: 'input'|'output' }
export type Decision =
  | 'answered'            // 正常作答
  | 'answered_caveat'     // 作答但置信中等，附"建议核实/可转人工"
  | 'partial_refusal'     // 问题部分越界：越界部分拒答、合规部分作答
  | 'refused'             // 整体越界，合规话术拒答 + 告警
  | 'handoff_unknown'     // 知识库无覆盖 → 转人工 + 记缺口
  | 'handoff_low_conf'    // 有召回但置信低 → 转人工 + 记缺口
  | 'handoff_request'     // 用户要求人工/投诉
  | 'degraded';           // LLM 异常，按原文抽取作答（仍做合规）
export interface Citation { n: number; chunkId: string; docKey: string; docTitle: string; version: number; heading: string; snippet: string }
export interface CheckResult { name: string; pass: boolean; detail: string }
export interface ChatRequest { question: string; userRisk: RiskLevel; sessionId: string; history?: {role:'user'|'assistant';content:string}[] }
export interface ChatResponse {
  id: string; decision: Decision; answer: string; citations: Citation[];
  confidence: number;                 // 0..1
  confidenceBreakdown: { retrieval: number; coverage: number; grounding: number; citation: number };
  handoff: null | { reason: string; ticketId: string|null };
  suitability: null | { userRisk: RiskLevel; productRisk: ProductRisk; matched: boolean; notice: string };
  disclaimer: string;                  // 统一风险提示
  compliance: ComplianceHit[];
  checks: CheckResult[];               // 每一步校验的结果（可追溯）
  retrieval: { chunkId: string; docTitle: string; heading: string; score: number }[];
  kbRelease: string;                   // 如 "v3"
  mode: 'llm'|'degraded'|'local';
  latencyMs: number; model: string|null;
}
```

## 5. 管线（core/pipeline.ts）
`runPipeline(req, adapters, opts): Promise<ChatResponse>`，adapters 由运行环境注入：
```ts
interface Adapters {
  retrieve(q: string): Promise<{ hits: Retrieved[]; mode: 'hybrid'|'keyword' }>;
  llm: null | ((messages: {role:string;content:string}[], o?: {maxTokens?: number; json?: boolean}) => Promise<string>);
  kbRelease: string;
  newId(): string;
}
```
步骤与规则（每步写入 `checks[]`）：
1. **输入校验**：去空白；空 → 400；>500 字截断并记 check；HTML 去标签。
2. **输入合规（规则引擎，确定性）** `compliance.ts`：正则+关键词词表，按类别命中。区分"教育性问题"与"越界请求"：如"什么是止损"是教育，"XX 股票该不该止损"是越界；"市盈率怎么看"是教育，"茅台市盈率高了还能买吗"是越界。个股识别：6 位代码、常见"XX股份/XX银行/茅台/宁德"等 + "这只/该股/个股"指代。
   - 整体越界（只有越界诉求）→ `refused`，答案用合规话术模板（templates.ts，内容需与 kb 中 compliance_script 文档一致并引用之），记告警。
   - 混合问题 → 继续走 RAG，但 prompt 中声明需拒答的部分，最终 `partial_refusal`。
   - `complaint_human` → `handoff_request`。`prompt_injection` → 记 high 告警，按正常问题处理但忽略注入指令。
3. **检索**：hybrid = 0.65·cos(bge-m3) + 0.35·BM25 归一化（CJK 用字二元组 + 词表词）；top 6，过滤 score<0.2；embedding 失败 → keyword 模式并记 check。
4. **覆盖判断**：top1 score < T_unknown(0.35，keyword 模式 0.25) → `handoff_unknown`（不调 LLM）。
5. **生成**：system prompt 规定：只依据【资料】回答；每句事实后标 [n]；资料不足时输出 `NO_ANSWER`；不得荐股/预测/承诺收益；需拒答部分用一句合规话术。要求 JSON：`{"answer": "...", "used": [1,3], "covered": true|false}`。解析失败重试 1 次，再失败 → degraded。
   LLM 抛错/超时（12s）→ `degraded`：取 top2 块原文摘要式拼接（≤220 字）+ 引用。
6. **输出合规**：对答案再跑规则（stage:'output'），命中 high → 丢弃答案换模板，decision=`refused`，记"输出越界"告警。
7. **引用校验**：`[n]` 必须在检索结果范围内；无引用的事实性回答扣分；非法引用剔除并记 check。
8. **落地性 grounding**：答案逐句与被引块做字二元组重合率，平均值即 grounding。
9. **置信度**：`0.35·retrieval + 0.25·coverage + 0.25·grounding + 0.15·citation`（retrieval=top1 归一化；coverage=LLM covered?1:0.3；citation=合法引用率）。≥0.62 answered；0.45–0.62 answered_caveat；<0.45 → handoff_low_conf（仍展示已得到的参考信息，标"待人工确认"）。
10. **适当性**：命中块含 productRisk 时，取最高 R 与 userRisk 比对（C1↔R1…C5↔R5，C≥R 才匹配）；不匹配 → notice："该类产品风险等级 R4 高于您的风险承受能力 C2，按适当性规则……" 并在答案末尾附提示。凡涉及投资产品的回答都附 `disclaimer`。
11. 返回 `ChatResponse`；Worker 侧负责落库（日志/告警/缺口/工单）。

## 6. D1 表（db/schema.sql）
- `documents(doc_key PK, title, category, product_risk, tags, created_at)`
- `doc_versions(id PK, doc_key, version, content, change_note, author, status['draft'|'published'|'archived'], gap_id NULL, created_at, published_at)`
- `releases(id PK, release_no TEXT 'v1'.., note, doc_versions_json, created_at, created_by)`；当前 release = 最新一条。
- `chunks(id PK, doc_key, doc_version_id, version, ord, heading, text, embedding TEXT(JSON), active INT)`
- `qa_logs(id PK, ts, session_id, question, user_risk, decision, confidence, answer, response_json, kb_release, mode, latency_ms, feedback INT NULL, feedback_note)`
- `alerts(id PK, ts, qa_id, category, severity, stage, matched, question, status['open'|'ack'], handled_by, handled_at)`
- `gaps(id PK, norm_key, sample_question, questions_json, count, type['unknown'|'low_conf'|'bad_feedback'|'wrong_answer'], status['open'|'drafting'|'resolved'|'ignored'], doc_key NULL, resolved_release NULL, first_seen, last_seen)`
  - 归并：问题归一化（去标点/语气词）后取字二元组 Jaccard ≥0.5 合并到同一 gap，count+1。
- `tickets(id PK, qa_id, reason, status['pending'|'processing'|'closed'], assignee, reply, created_at, updated_at)`

## 7. API（functions/api，JSON，错误统一 `{error:{code,message}}`）
| 方法 路径 | 说明 |
|---|---|
| GET `/api/health` | `{ok, kbRelease, chunks, ai: true|false}` |
| POST `/api/chat` | ChatRequest → ChatResponse。支持故障注入头 `x-fault: llm|embed|db|slow-llm`（测试用，README 说明） |
| POST `/api/feedback` | `{qaId, helpful: boolean, note?}`；差评→ gap(type=bad_feedback) |
| GET `/api/logs?decision=&q=&limit=` | 问答日志列表 |
| GET `/api/logs/:id` | 单条完整追溯（含 response_json） |
| GET `/api/dashboard` | 总览：近 7 天量、各 decision 占比、平均置信度、告警数、缺口数、Top 未答问题、Top 越界类别 |
| GET `/api/gaps?status=` / POST `/api/gaps/:id` `{action:'ignore'|'draft'}` | draft 时生成草稿文档版本（预填问题样例）并返回 doc_version id |
| POST `/api/gaps/:id/verify` | 用当前 release 重跑该 gap 全部问题，全部非 handoff 则 resolved 并记 resolved_release |
| GET `/api/alerts?status=` / POST `/api/alerts/:id/ack` | 越界告警 |
| GET `/api/tickets` / POST `/api/tickets/:id` `{status, reply}` | 人工工单 |
| GET `/api/kb/docs` | 文档列表（当前发布版本号、块数、最近修改） |
| GET `/api/kb/docs/:docKey` | 全部版本 |
| POST `/api/kb/docs` | 新建/编辑 → 产生 draft 版本 `{docKey?, title, category, productRisk, tags, content, changeNote}` |
| POST `/api/kb/publish` | `{versionIds:[], note}` → 切分+embedding+新 release，旧版本 archived、旧块 active=0 |
| POST `/api/kb/rollback` | `{docKey, version}` → 以历史版本内容重新发布（新 release） |
| GET `/api/kb/releases` | release 历史 |
| POST `/api/kb/preview-chunks` | `{content}` → 切分预览（不落库） |
| POST `/api/eval/run` | 跑 eval/questions.json（可传 `ids` 子集），返回逐题结果与通过率 |
| POST `/api/admin/seed` | 用 kb-bundle 初始化（幂等；需 header `x-admin-token` 等于 env `ADMIN_TOKEN`；若未设则仅本地可用） |

写操作（发布/回滚/工单）是演示用运营后台，无登录；README 写明"生产需加 RBAC"。所有接口加简单限流（每 IP 每分钟 20 次 chat）。

## 8. 评测集（eval/questions.json）
```json
[{ "id": "N01", "type": "normal|mixed|out_of_scope|unknown|injection|suitability|human",
   "question": "...", "userRisk": "C3",
   "expect": { "decisionIn": ["answered","answered_caveat"], "mustCiteDocKeys": ["rule-star-market-access"],
               "mustNotContain": ["建议买入"], "alert": "price_prediction|null" } }]
```
≥ 60 题：normal 25、mixed 8、out_of_scope 12、unknown 8、injection 4、suitability 5、human 3。

## 9. 前端（web/）
- 路由：`/`（落地说明 + 两个入口）、`/app`（用户端，手机框，App 投教助手）、`/ops/*`（运营后台）。
- 用户端：风险等级选择（C1–C5 演示用）、快捷问题、消息流；每条答案显示：决策标签、置信度条、引用角标 → 展开来源（文档名+版本+小节+原文片段）、适当性提示、免责声明、👍/👎、转人工卡片（工单号）。"查看追溯"链接跳到后台该条日志。
- 运营后台：总览 / 问答追溯 / 知识缺口 / 越界告警 / 人工工单 / 知识库（文档、版本历史、编辑→切分预览→发布、回滚、diff）/ 评测。
- 设计：克制、信息密度高（Linear/Stripe 风），中文排版，亮暗皆可；主色深蓝灰+一个警示色；决策标签配色固定。矮窗口（约 1389×713）下不溢出。
- 本地演示模式：`api.ts` 先探测 `/api/health`（2.5s 超时），失败 → `localEngine`（core + kb-bundle.json），顶部黄条"本地演示模式：接口不可达，使用浏览器内检索与规则引擎，回答为知识原文摘录"。本地模式下后台数据存 localStorage。

## 10. 合规底线（全员遵守）
不荐股、不预测、不承诺收益、不代客操作；所有投资相关回答带风险提示；适当性不匹配必须提示；越界必留痕告警；知识事实必须准确（公开监管规则），拿不准就不写或写成"以官方/交易所最新规则为准"。
