/// <reference types="node" />
// 用 node:sqlite 模拟 D1（prepare/bind/all/first/run/batch），供 Functions 集成测试。
import { DatabaseSync } from 'node:sqlite';

export function createFakeD1(): D1Database & { raw: DatabaseSync } {
  const db = new DatabaseSync(':memory:');
  const norm = (v: unknown) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v);
  const stmt = (sql: string, args: unknown[] = []): any => ({
    sql, args,
    bind: (...a: unknown[]) => stmt(sql, a.map(norm)),
    async all() { return { results: db.prepare(sql).all(...(args as any[])).map((r) => ({ ...r })), success: true, meta: {} }; },
    async first(col?: string) { const r = db.prepare(sql).get(...(args as any[])) as any; if (!r) return null; return col ? r[col] : { ...r }; },
    async run() { const r = db.prepare(sql).run(...(args as any[])); return { success: true, meta: { changes: r.changes } }; },
    _exec() { return db.prepare(sql).run(...(args as any[])); },
  });
  const d1: any = {
    raw: db,
    prepare: (sql: string) => stmt(sql),
    async batch(stmts: any[]) {
      db.exec('BEGIN');
      try { const out = stmts.map((s) => { const st = db.prepare(s.sql); return /^\s*select/i.test(s.sql) ? { results: st.all(...s.args) } : (st.run(...s.args), { success: true }); }); db.exec('COMMIT'); return out; }
      catch (e) { db.exec('ROLLBACK'); throw e; }
    },
    async exec(sql: string) { db.exec(sql); return { count: 1 }; },
  };
  return d1;
}
