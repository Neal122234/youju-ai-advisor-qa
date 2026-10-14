import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { ChatResponse, Decision } from '../apiTypes';
import { DECISION_LABEL, DECISION_TONE, THRESHOLDS, pct } from './labels';

/* ---------- 路由（hash） ---------- */
export function useHashRoute(): string {
  const get = () => (location.hash.replace(/^#/, '') || '/');
  const [r, setR] = useState(get);
  useEffect(() => {
    const on = () => setR(get());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return r;
}
export const go = (path: string) => { location.hash = path; };
export function splitRoute(route: string): { path: string; query: URLSearchParams } {
  const [p, q] = route.split('?');
  return { path: p, query: new URLSearchParams(q ?? '') };
}

/* ---------- 数据加载 ---------- */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const reload = useCallback(() => {
    const n = ++seq.current;
    setLoading(true); setError(null);
    fn().then((d) => { if (n === seq.current) setData(d); })
      .catch((e) => { if (n === seq.current) setError(e?.message ?? String(e)); })
      .finally(() => { if (n === seq.current) setLoading(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { reload(); }, [reload]);
  return { data, error, loading, reload, setData };
}

/* ---------- 图标（内联 SVG，currentColor） ---------- */
const P: Record<string, ReactNode> = {
  chart: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>,
  list: <><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></>,
  gap: <><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3M11 8v3M11 14h.01" /></>,
  shield: <><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z" /><path d="M12 8v4M12 15h.01" /></>,
  headset: <><path d="M4 14v-2a8 8 0 0116 0v2" /><rect x="3" y="14" width="4" height="6" rx="1.5" /><rect x="17" y="14" width="4" height="6" rx="1.5" /></>,
  book: <><path d="M4 4h6a2 2 0 012 2v14a2 2 0 00-2-2H4zM20 4h-6a2 2 0 00-2 2v14a2 2 0 012-2h6z" /></>,
  check: <><path d="M5 12l5 5L20 7" /></>,
  flask: <><path d="M9 3h6M10 3v6L4.5 18.5A1.5 1.5 0 005.8 21h12.4a1.5 1.5 0 001.3-2.5L14 9V3" /><path d="M7.5 15h9" /></>,
  thumbUp: <><path d="M7 11v9H4v-9zM7 11l4-8a2 2 0 012 2v4h5.5a2 2 0 012 2.3l-1.2 7A2 2 0 0117.3 20H7" /></>,
  thumbDown: <><path d="M17 13V4h3v9zM17 13l-4 8a2 2 0 01-2-2v-4H5.5a2 2 0 01-2-2.3l1.2-7A2 2 0 016.7 4H17" /></>,
  send: <><path d="M4 12l16-8-6 16-2.5-6.5z" /></>,
  arrowLeft: <><path d="M15 6l-6 6 6 6" /></>,
  arrowRight: <><path d="M9 6l6 6-6 6" /></>,
  external: <><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5" /></>,
  x: <><path d="M6 6l12 12M18 6L6 18" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0116 0" /></>,
  grid: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
  refresh: <><path d="M20 11a8 8 0 10-2.3 5.7M20 4v7h-7" /></>,
  menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
  doc: <><path d="M14 3H6a1 1 0 00-1 1v16a1 1 0 001 1h12a1 1 0 001-1V8z" /><path d="M14 3v5h5M9 13h6M9 17h6" /></>,
};
export function Icon({ name, size = 16, className }: { name: keyof typeof P | string; size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {P[name]}
    </svg>
  );
}

/* ---------- 决策标签 ---------- */
export function DecisionTag({ d, compact }: { d: Decision | string; compact?: boolean }) {
  const tone = DECISION_TONE[d] ?? 'gray';
  return <span className={`dtag tone-${tone}${compact ? ' compact' : ''}`} title={d}><i />{DECISION_LABEL[d as Decision] ?? d}</span>;
}
export function Pill({ tone = 'gray', children }: { tone?: string; children: ReactNode }) {
  return <span className={`pill tone-${tone}`}>{children}</span>;
}

/* ---------- 置信度条：0.45 / 0.62 阈值刻度 ---------- */
export function ConfidenceBar({ value, breakdown, showDetail = false }: { value: number; breakdown?: ChatResponse['confidenceBreakdown']; showDetail?: boolean }) {
  const [open, setOpen] = useState(showDetail);
  const tone = value >= THRESHOLDS.answered ? 'green' : value >= THRESHOLDS.caveat ? 'yellow' : 'blue';
  return (
    <div className="conf">
      <button type="button" className="conf-row" onClick={() => breakdown && setOpen((o) => !o)} aria-expanded={open} disabled={!breakdown}>
        <span className="conf-label">置信度</span>
        <span className="conf-track">
          <span className={`conf-fill tone-${tone}`} style={{ width: pct(Math.max(0, Math.min(1, value))) }} />
          <span className="conf-tick" style={{ left: pct(THRESHOLDS.caveat) }} />
          <span className="conf-tick" style={{ left: pct(THRESHOLDS.answered) }} />
        </span>
        <span className="conf-val num">{value.toFixed(2)}</span>
      </button>
      {open && breakdown && <Breakdown b={breakdown} total={value} />}
    </div>
  );
}
export function Breakdown({ b, total }: { b: ChatResponse['confidenceBreakdown']; total: number }) {
  const rows: [string, number, number, string][] = [
    ['检索', b.retrieval, 0.35, 'top1 检索分归一化'],
    ['覆盖', b.coverage, 0.25, '资料是否覆盖问题'],
    ['落地性', b.grounding, 0.25, '答案与引用原文重合度'],
    ['引用', b.citation, 0.15, '合法引用占比'],
  ];
  return (
    <div className="bd">
      {rows.map(([k, v, w, hint]) => (
        <div className="bd-row" key={k} title={hint}>
          <span className="bd-k">{k}<em>×{w}</em></span>
          <span className="bd-track"><span style={{ width: pct(Math.max(0, Math.min(1, v))) }} /></span>
          <span className="num">{v.toFixed(2)}</span>
        </div>
      ))}
      <div className="bd-foot">
        合计 <b className="num">{total.toFixed(2)}</b>；≥{THRESHOLDS.answered} 直接作答，{THRESHOLDS.caveat}–{THRESHOLDS.answered} 附核实提示，&lt;{THRESHOLDS.caveat} 转人工
      </div>
    </div>
  );
}

/* ---------- 杂项 ---------- */
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="empty"><b>{title}</b>{children && <div>{children}</div>}</div>;
}
export function Loading({ rows = 4 }: { rows?: number }) {
  return <div className="skel-wrap" aria-busy="true">{Array.from({ length: rows }, (_, i) => <div className="skel" key={i} style={{ width: `${90 - i * 13}%` }} />)}</div>;
}
export function ErrorBox({ msg, onRetry }: { msg: string; onRetry?: () => void }) {
  return <div className="errbox"><Icon name="info" /> <span>{msg}</span>{onRetry && <button className="btn sm" onClick={onRetry}>重试</button>}</div>;
}

let toastFn: ((m: string, tone?: string) => void) | null = null;
export const toast = (m: string, tone = 'gray') => toastFn?.(m, tone);
export function Toaster() {
  const [items, setItems] = useState<{ id: number; m: string; tone: string }[]>([]);
  useEffect(() => {
    toastFn = (m, tone = 'gray') => {
      const id = Date.now() + Math.random();
      setItems((x) => [...x, { id, m, tone }]);
      setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 3200);
    };
    return () => { toastFn = null; };
  }, []);
  return <div className="toaster" role="status">{items.map((i) => <div key={i.id} className={`toast tone-${i.tone}`}>{i.m}</div>)}</div>;
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-h"><b>{title}</b><button className="icon-btn" onClick={onClose} aria-label="关闭"><Icon name="x" /></button></div>
        <div className="modal-b">{children}</div>
      </div>
    </div>
  );
}

/** 正文：把 [n] 渲染成可点角标 */
export function AnswerText({ text, onCite, active }: { text: string; onCite?: (n: number) => void; active?: number | null }) {
  const parts = text.split(/(\[\d+\])/g);
  return (
    <div className="answer-text">
      {parts.map((p, i) => {
        const m = p.match(/^\[(\d+)\]$/);
        if (m) {
          const n = +m[1];
          return <button type="button" key={i} className={`cite${active === n ? ' on' : ''}`} onClick={() => onCite?.(n)} aria-label={`查看来源 ${n}`}>{n}</button>;
        }
        return <span key={i}>{p}</span>;
      })}
    </div>
  );
}
