// GET /api/dashboard 近 7 天总览
import type { Env } from '../_lib/env';
import { json } from '../_lib/http';
import { all, first, loadKb } from '../_lib/db';

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const db = env.DB;
  const since = new Date(Date.now() - 7 * 86400_000).toISOString();
  const dist = await all<{ decision: string; count: number }>(db, 'SELECT decision, COUNT(*) AS count FROM qa_logs WHERE ts >= ? GROUP BY decision ORDER BY count DESC', since);
  const total = dist.reduce((a, d) => a + d.count, 0);
  const handoff = dist.filter((d) => d.decision.startsWith('handoff')).reduce((a, d) => a + d.count, 0);
  const blocked = dist.filter((d) => d.decision === 'refused' || d.decision === 'partial_refusal').reduce((a, d) => a + d.count, 0);
  const avg = await first<{ c: number | null }>(db, `SELECT AVG(confidence) AS c FROM qa_logs WHERE ts >= ? AND decision NOT IN ('refused','handoff_request')`, since);
  const daily = await all<{ date: string; count: number }>(db, 'SELECT substr(ts, 1, 10) AS date, COUNT(*) AS count FROM qa_logs WHERE ts >= ? GROUP BY date ORDER BY date', since);
  const openAlerts = await first<{ n: number }>(db, `SELECT COUNT(*) AS n FROM alerts WHERE status = 'open'`);
  const alerts7 = await first<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM alerts WHERE ts >= ?', since);
  const openGaps = await first<{ n: number }>(db, `SELECT COUNT(*) AS n FROM gaps WHERE status IN ('open','drafting')`);
  const pendingTickets = await first<{ n: number }>(db, `SELECT COUNT(*) AS n FROM tickets WHERE status != 'closed'`);
  const topUnanswered = await all<{ question: string; count: number }>(db, `SELECT sample_question AS question, count FROM gaps WHERE status IN ('open','drafting') ORDER BY count DESC, last_seen DESC LIMIT 8`);
  const topViolations = await all<{ category: string; count: number }>(db, 'SELECT category, COUNT(*) AS count FROM alerts WHERE ts >= ? GROUP BY category ORDER BY count DESC', since);
  const fb = await first<{ up: number; down: number }>(db, 'SELECT SUM(CASE WHEN feedback = 1 THEN 1 ELSE 0 END) AS up, SUM(CASE WHEN feedback = 0 THEN 1 ELSE 0 END) AS down FROM qa_logs WHERE ts >= ?', since);
  const kb = await loadKb(db);
  const days: { date: string; count: number }[] = [];
  for (let i = 6; i >= 0; i--) { const d = new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10); days.push({ date: d, count: daily.find((x) => x.date === d)?.count ?? 0 }); }
  return json({
    total, autoResolveRate: total ? Math.round((1 - handoff / total) * 1000) / 1000 : 0, handoffRate: total ? Math.round((handoff / total) * 1000) / 1000 : 0,
    blockedCount: blocked, refusedCount: blocked, avgConfidence: Math.round((avg?.c ?? 0) * 1000) / 1000, openAlerts: openAlerts?.n ?? 0, alerts7d: alerts7?.n ?? 0,
    openGaps: openGaps?.n ?? 0, pendingTickets: pendingTickets?.n ?? 0, feedback: { up: fb?.up ?? 0, down: fb?.down ?? 0 },
    decisionDist: dist, topUnanswered, topViolations, daily: days, kbRelease: kb.release,
  });
};
