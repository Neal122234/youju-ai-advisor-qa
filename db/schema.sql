-- 有据 D1 表结构（SPEC §6）。幂等：可重复执行。
-- 本地：npx wrangler d1 execute zhijie-qa --local --file db/schema.sql
-- 线上：npx wrangler d1 execute zhijie-qa --remote --file db/schema.sql

CREATE TABLE IF NOT EXISTS documents (
  doc_key      TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  category     TEXT NOT NULL,
  product_risk TEXT,                       -- R1..R5 | NULL
  tags         TEXT NOT NULL DEFAULT '[]', -- JSON 数组
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS doc_versions (
  id           TEXT PRIMARY KEY,
  doc_key      TEXT NOT NULL,
  version      INTEGER NOT NULL,
  content      TEXT NOT NULL,              -- 完整 markdown（含 front-matter）
  change_note  TEXT NOT NULL DEFAULT '',
  author       TEXT NOT NULL DEFAULT '运营',
  status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  gap_id       TEXT,
  created_at   TEXT NOT NULL,
  published_at TEXT,
  UNIQUE (doc_key, version)
);
CREATE INDEX IF NOT EXISTS idx_docver_doc ON doc_versions(doc_key, status);

CREATE TABLE IF NOT EXISTS releases (
  id                TEXT PRIMARY KEY,
  release_no        TEXT NOT NULL UNIQUE,  -- v1, v2 …
  seq               INTEGER NOT NULL,      -- 数字序号，便于取最新
  note              TEXT NOT NULL DEFAULT '',
  doc_versions_json TEXT NOT NULL DEFAULT '[]', -- 该 release 生效的全部 doc_version id
  created_at        TEXT NOT NULL,
  created_by        TEXT NOT NULL DEFAULT '运营'
);

CREATE TABLE IF NOT EXISTS chunks (
  id             TEXT PRIMARY KEY,         -- ${doc_key}@v${version}#${ord}
  doc_key        TEXT NOT NULL,
  doc_version_id TEXT NOT NULL,
  version        INTEGER NOT NULL,
  ord            INTEGER NOT NULL,
  heading        TEXT NOT NULL,
  text           TEXT NOT NULL,
  embedding      TEXT,                     -- JSON number[1024]（bge-m3），NULL=未向量化
  active         INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_chunks_active ON chunks(active, doc_key);

CREATE TABLE IF NOT EXISTS qa_logs (
  id            TEXT PRIMARY KEY,
  ts            TEXT NOT NULL,
  session_id    TEXT NOT NULL DEFAULT '',
  question      TEXT NOT NULL,             -- 已脱敏
  user_risk     TEXT NOT NULL,
  decision      TEXT NOT NULL,
  confidence    REAL NOT NULL DEFAULT 0,
  answer        TEXT NOT NULL DEFAULT '',
  response_json TEXT NOT NULL DEFAULT '{}',
  kb_release    TEXT NOT NULL DEFAULT '',
  mode          TEXT NOT NULL DEFAULT 'llm',
  latency_ms    INTEGER NOT NULL DEFAULT 0,
  feedback      INTEGER,                   -- 1 有帮助 / 0 没帮助 / NULL
  feedback_note TEXT
);
CREATE INDEX IF NOT EXISTS idx_qa_ts ON qa_logs(ts);
CREATE INDEX IF NOT EXISTS idx_qa_decision ON qa_logs(decision, ts);

CREATE TABLE IF NOT EXISTS alerts (
  id         TEXT PRIMARY KEY,
  ts         TEXT NOT NULL,
  qa_id      TEXT,
  category   TEXT NOT NULL,
  severity   TEXT NOT NULL,
  stage      TEXT NOT NULL,                -- input | output
  matched    TEXT NOT NULL DEFAULT '',
  question   TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','ack')),
  handled_by TEXT,
  handled_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status, ts);

CREATE TABLE IF NOT EXISTS gaps (
  id               TEXT PRIMARY KEY,
  norm_key         TEXT NOT NULL,
  sample_question  TEXT NOT NULL,
  questions_json   TEXT NOT NULL DEFAULT '[]',
  count            INTEGER NOT NULL DEFAULT 1,
  type             TEXT NOT NULL CHECK (type IN ('unknown','low_conf','bad_feedback','wrong_answer')),
  status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','drafting','resolved','ignored')),
  doc_key          TEXT,
  resolved_release TEXT,
  first_seen       TEXT NOT NULL,
  last_seen        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gaps_status ON gaps(status, last_seen);

CREATE TABLE IF NOT EXISTS tickets (
  id         TEXT PRIMARY KEY,
  qa_id      TEXT,
  reason     TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','closed')),
  assignee   TEXT,
  reply      TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status, created_at);

-- 全局限流计数（按 IP + 分钟窗口 upsert；过期行定期清理）
CREATE TABLE IF NOT EXISTS rate_limits (
  key        TEXT PRIMARY KEY,           -- chat:<ip>:<epochMinute>
  n          INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL            -- epoch 秒
);
