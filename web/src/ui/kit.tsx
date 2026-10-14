import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { ChatResponse, Citation, Decision } from '../apiTypes';
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
  copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3" /></>,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  compose: <><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" /></>,
  arrowDown: <><path d="M12 5v14M6 13l6 6 6-6" /></>,
  chevronDown: <><path d="M6 9l6 6 6-6" /></>,
  chevronUp: <><path d="M6 15l6-6 6 6" /></>,
  sort: <><path d="M8 10l4-4 4 4M8 14l4 4 4-4" /></>,
  checkCircle: <><circle cx="12" cy="12" r="9" /><path d="M8 12.5l2.8 2.8L16 9.8" /></>,
  alert: <><path d="M12 3l9.5 17h-19z" /><path d="M12 10v4M12 17h.01" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></>,
  wallet: <><rect x="3" y="6" width="18" height="14" rx="2" /><path d="M3 10h18M16 15h2" /></>,
  key: <><circle cx="8" cy="15" r="4" /><path d="M11 12l9-9M16 7l3 3" /></>,
  bulb: <><path d="M9 18h6M10 21h4M12 3a6 6 0 00-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0012 3z" /></>,
  terminal: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 9l3 3-3 3M13 15h4" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
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
/** 空状态：一张简单线稿 + 标题 + 下一步指引 */
export function Empty({ title, children, art = 'search', compact }: { title: string; children?: ReactNode; art?: 'search' | 'inbox' | 'shield' | 'doc'; compact?: boolean }) {
  return (
    <div className={`empty${compact ? ' compact' : ''}`}>
      {!compact && <EmptyArt kind={art} />}
      <b>{title}</b>{children && <div className="empty-d">{children}</div>}
    </div>
  );
}
function EmptyArt({ kind }: { kind: string }) {
  return (
    <svg className="empty-art" width="88" height="64" viewBox="0 0 88 64" fill="none" aria-hidden="true">
      <rect x="14" y="8" width="44" height="50" rx="5" className="ea-paper" />
      <path d="M23 21h26M23 29h26M23 37h16" className="ea-line" />
      {kind === 'search' && <><circle cx="62" cy="40" r="11" className="ea-accent-fill" /><circle cx="62" cy="40" r="11" className="ea-accent" /><path d="M70 48l7 7" className="ea-accent" /></>}
      {kind === 'inbox' && <><path d="M48 44h28l-4 12H52z" className="ea-accent-fill" /><path d="M48 44h28l-4 12H52zM56 44l2 4h8l2-4" className="ea-accent" /></>}
      {kind === 'shield' && <><path d="M64 30l11 4v8c0 7-5 11-11 13-6-2-11-6-11-13v-8z" className="ea-accent-fill" /><path d="M64 30l11 4v8c0 7-5 11-11 13-6-2-11-6-11-13v-8zM59 43l4 4 6-7" className="ea-accent" /></>}
      {kind === 'doc' && <><rect x="52" y="30" width="22" height="26" rx="3" className="ea-accent-fill" /><path d="M58 30v26M52 38h22" className="ea-accent" /><rect x="52" y="30" width="22" height="26" rx="3" className="ea-accent" /></>}
    </svg>
  );
}
export function Loading({ rows = 4 }: { rows?: number }) {
  return <div className="skel-wrap" aria-busy="true" aria-label="加载中">{Array.from({ length: rows }, (_, i) => <div className="skel" key={i} style={{ width: `${90 - i * 13}%` }} />)}</div>;
}
/** 表格骨架：表头 + n 行占位 */
export function TableSkeleton({ cols = 6, rows = 8 }: { cols?: number; rows?: number }) {
  return (
    <div className="tbl-wrap" aria-busy="true" aria-label="加载中">
      <table className="tbl skel-tbl">
        <thead><tr>{Array.from({ length: cols }, (_, i) => <th key={i}><span className="skel" style={{ width: i === 1 ? 80 : 40 }} /></th>)}</tr></thead>
        <tbody>
          {Array.from({ length: rows }, (_, r) => (
            <tr key={r}>{Array.from({ length: cols }, (_, c) => <td key={c}><span className="skel" style={{ width: c === 1 ? `${60 + ((r * 17) % 35)}%` : `${40 + ((r + c) * 13) % 40}%` }} /></td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function ErrorBox({ msg, onRetry }: { msg: string; onRetry?: () => void }) {
  return (
    <div className="errbox" role="alert">
      <Icon name="alert" />
      <div className="errbox-t"><b>{onRetry ? '数据加载失败' : '操作失败'}</b><span>{msg}</span></div>
      {onRetry && <button className="btn sm" onClick={onRetry}><Icon name="refresh" size={13} /> 重试</button>}
    </div>
  );
}

let toastFn: ((m: string, tone?: string) => void) | null = null;
export const toast = (m: string, tone = 'gray') => toastFn?.(m, tone);
const TOAST_ICON: Record<string, string> = { green: 'checkCircle', red: 'alert', orange: 'alert', gray: 'info', blue: 'info' };
export function Toaster() {
  const [items, setItems] = useState<{ id: number; m: string; tone: string }[]>([]);
  useEffect(() => {
    toastFn = (m, tone = 'gray') => {
      const id = Date.now() + Math.random();
      setItems((x) => [...x.slice(-2), { id, m, tone }]);
      setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), tone === 'red' ? 5000 : 3200);
    };
    return () => { toastFn = null; };
  }, []);
  return (
    <>
      <div className="toaster" role="status" aria-live="polite">
        {items.map((i) => (
          <div key={i.id} className={`toast tone-${i.tone}`}>
            <Icon name={TOAST_ICON[i.tone] ?? 'info'} size={15} /><span>{i.m}</span>
            <button className="toast-x" onClick={() => setItems((x) => x.filter((y) => y.id !== i.id))} aria-label="关闭提示"><Icon name="x" size={12} /></button>
          </div>
        ))}
      </div>
      <ConfirmHost />
    </>
  );
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
export function Modal({ title, onClose, children, wide, footer, tone }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; footer?: ReactNode; tone?: 'danger' }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    // 首个输入控件优先，否则聚焦主按钮
    // 首个可用控件（跳过 disabled，disabled 按钮 focus() 会静默失败、焦点留在 body）；都没有则聚焦对话框本身
    const first = el?.querySelector<HTMLElement>('[data-autofocus]') ?? el?.querySelector<HTMLElement>('.modal-b input:not(:disabled), .modal-b textarea:not(:disabled), .modal-b select:not(:disabled)') ?? el?.querySelector<HTMLElement>('.modal-f .btn.primary:not(:disabled), .modal-f .btn.danger:not(:disabled)');
    (first ?? el)?.focus();
    if (el && !el.contains(document.activeElement)) el.focus();
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); closeRef.current(); return; }
      if (e.key === 'Tab' && el) {
        const fs = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null);
        if (!fs.length) return;
        const a = fs[0], b = fs[fs.length - 1];
        if (e.shiftKey && document.activeElement === a) { e.preventDefault(); b.focus(); }
        else if (!e.shiftKey && document.activeElement === b) { e.preventDefault(); a.focus(); }
      }
    };
    window.addEventListener('keydown', k, true);
    return () => { window.removeEventListener('keydown', k, true); prev?.focus?.(); };
  }, []);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} tabIndex={-1} className={`modal${wide ? ' wide' : ''}${tone ? ' ' + tone : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-h"><b>{tone === 'danger' && <Icon name="alert" size={16} />}{title}</b><button className="icon-btn" onClick={onClose} aria-label="关闭"><Icon name="x" /></button></div>
        <div className="modal-b">{children}</div>
        {footer && <div className="modal-f">{footer}</div>}
      </div>
    </div>
  );
}

/* ---------- 二次确认：await confirmDialog({...}) ---------- */
type ConfirmOpts = { title: string; body?: ReactNode; confirmText?: string; cancelText?: string; danger?: boolean };
let confirmFn: ((o: ConfirmOpts) => Promise<boolean>) | null = null;
export const confirmDialog = (o: ConfirmOpts) => (confirmFn ? confirmFn(o) : Promise.resolve(false));
function ConfirmHost() {
  const [cur, setCur] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);
  useEffect(() => {
    confirmFn = (o) => new Promise<boolean>((resolve) => setCur({ ...o, resolve }));
    return () => { confirmFn = null; };
  }, []);
  if (!cur) return null;
  const done = (v: boolean) => { cur.resolve(v); setCur(null); };
  return (
    <Modal
      title={cur.title}
      tone={cur.danger ? 'danger' : undefined}
      onClose={() => done(false)}
      footer={<>
        <button className="btn" onClick={() => done(false)}>{cur.cancelText ?? '取消'}</button>
        <button className={`btn ${cur.danger ? 'danger' : 'primary'}`} onClick={() => done(true)}>{cur.confirmText ?? '确认'}</button>
      </>}
    >
      {typeof cur.body === 'string' ? <p className="confirm-body">{cur.body}</p> : cur.body}
    </Modal>
  );
}

/* ---------- URL hash 中的筛选状态：刷新、返回都能还原 ---------- */
function readHashQuery() { return new URLSearchParams(location.hash.split('?')[1] ?? ''); }
export function useHashState(name: string, def = ''): [string, (v: string) => void] {
  const [v, setV] = useState(() => readHashQuery().get(name) ?? def);
  const set = useCallback((nv: string) => {
    setV(nv);
    const [p] = location.hash.replace(/^#/, '').split('?');
    const q = readHashQuery();
    if (nv === def || nv === '') q.delete(name); else q.set(name, nv);
    const qs = q.toString();
    history.replaceState(history.state, '', `#${p}${qs ? '?' + qs : ''}`);
  }, [name, def]);
  return [v, set];
}

/* ---------- 表格排序 + 分页 ---------- */
export type SortDir = 'asc' | 'desc';
export function useTable<T>(rows: T[], accessors: Record<string, (r: T) => string | number>, o: { defaultSort?: string; defaultDir?: SortDir; pageSize?: number } = {}) {
  const [sort, setSort] = useHashState('sort', o.defaultSort ?? '');
  const [dir, setDir] = useHashState('dir', o.defaultDir ?? 'desc');
  const [pageS, setPageS] = useHashState('page', '1');
  const size = o.pageSize ?? 20;
  const sorted = (() => {
    const acc = accessors[sort];
    if (!acc) return rows;
    const m = dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => { const x = acc(a), y = acc(b); return (x < y ? -1 : x > y ? 1 : 0) * m; });
  })();
  const pages = Math.max(1, Math.ceil(sorted.length / size));
  const page = Math.min(pages, Math.max(1, +pageS || 1));
  const view = sorted.slice((page - 1) * size, page * size);
  const th = (key: string, label: ReactNode, cls = '') => (
    <SortTh key={key} active={sort === key} dir={dir as SortDir} className={cls} onClick={() => {
      if (sort === key) setDir(dir === 'asc' ? 'desc' : 'asc'); else { setSort(key); setDir(o.defaultDir ?? 'desc'); }
      setPageS('1');
    }}>{label}</SortTh>
  );
  return { view, page, pages, total: sorted.length, size, setPage: (n: number) => setPageS(String(n)), resetPage: () => setPageS('1'), th };
}
export function SortTh({ active, dir, onClick, children, className }: { active: boolean; dir: SortDir; onClick: () => void; children: ReactNode; className?: string }) {
  return (
    <th className={className} aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className={`th-sort${active ? ' on' : ''}`} onClick={onClick}>
        {children}<Icon name={active ? (dir === 'asc' ? 'chevronUp' : 'chevronDown') : 'sort'} size={12} />
      </button>
    </th>
  );
}
export function Pager({ page, pages, total, size, onPage }: { page: number; pages: number; total: number; size: number; onPage: (n: number) => void }) {
  if (total <= size) return total ? <div className="pager"><span className="muted small num">共 {total} 条</span></div> : null;
  const nums: (number | '…')[] = [];
  for (let i = 1; i <= pages; i++) {
    if (i === 1 || i === pages || Math.abs(i - page) <= 1) nums.push(i);
    else if (nums[nums.length - 1] !== '…') nums.push('…');
  }
  return (
    <nav className="pager" aria-label="分页">
      <span className="muted small num">第 {(page - 1) * size + 1}–{Math.min(total, page * size)} 条，共 {total} 条</span>
      <div className="pager-b">
        <button className="icon-btn" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="上一页"><Icon name="arrowLeft" size={14} /></button>
        {nums.map((n, i) => n === '…' ? <span key={'e' + i} className="muted small">…</span> : (
          <button key={n} className={`pg num${n === page ? ' on' : ''}`} aria-current={n === page ? 'page' : undefined} onClick={() => onPage(n)}>{n}</button>
        ))}
        <button className="icon-btn" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="下一页"><Icon name="arrowRight" size={14} /></button>
      </div>
    </nav>
  );
}

/* ---------- 列表滚动位置：进详情前记住，返回时还原 ---------- */
const SCROLL_KEY = 'youju.listpos';
export function rememberListPos(listKey: string) {
  const el = document.querySelector('.ops-main');
  try { sessionStorage.setItem(SCROLL_KEY, JSON.stringify({ k: listKey, y: el?.scrollTop ?? 0, href: location.hash })); } catch { /* ignore */ }
}
export function lastListHref(listKey: string, fallback: string) {
  try { const v = JSON.parse(sessionStorage.getItem(SCROLL_KEY) ?? 'null'); if (v?.k === listKey && v.href) return v.href as string; } catch { /* ignore */ }
  return fallback;
}
export function useRestoreListPos(listKey: string, ready: boolean) {
  const done = useRef(false);
  useEffect(() => {
    if (!ready || done.current) return;
    done.current = true;
    try {
      const v = JSON.parse(sessionStorage.getItem(SCROLL_KEY) ?? 'null');
      if (v?.k === listKey && v.href === location.hash) requestAnimationFrame(() => document.querySelector('.ops-main')?.scrollTo(0, v.y));
    } catch { /* ignore */ }
  }, [ready, listKey]);
}

/* ---------- 侧栏待处理角标：处理告警/缺口后通知刷新 ---------- */
export const NAV_COUNTS_EVENT = 'youju:nav-counts';
export const refreshNavCounts = () => window.dispatchEvent(new Event(NAV_COUNTS_EVENT));

/* ---------- 面包屑 ---------- */
export function Crumbs({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav className="crumbs" aria-label="面包屑">
      {items.map((it, i) => (
        <span key={i} className="crumb">
          {i > 0 && <Icon name="arrowRight" size={11} className="crumb-sep" />}
          {it.href ? <a href={it.href}>{it.label}</a> : <span aria-current="page">{it.label}</span>}
        </span>
      ))}
    </nav>
  );
}

/* ---------- 迷你趋势图 ---------- */
export function Sparkline({ values, w = 96, h = 28 }: { values: number[]; w?: number; h?: number }) {
  if (values.length < 2) return null;
  const max = Math.max(1, ...values), min = Math.min(0, ...values);
  const x = (i: number) => (i / (values.length - 1)) * (w - 4) + 2;
  const y = (v: number) => h - 3 - ((v - min) / (max - min || 1)) * (h - 6);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  return (
    <svg className="spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <path d={`${d}L${x(values.length - 1)},${h}L${x(0)},${h}Z`} className="spark-area" />
      <path d={d} className="spark-line" />
      <circle cx={x(values.length - 1)} cy={y(values[values.length - 1])} r="2.5" className="spark-dot" />
    </svg>
  );
}

/* ---------- 键盘：/ 聚焦页面搜索框 ---------- */
export function useSlashFocus() {
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable="true"]') || document.querySelector('.modal-bg')) return;
      const el = document.querySelector<HTMLInputElement>('[data-search]');
      if (el) { e.preventDefault(); el.focus(); el.select(); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);
}

/** 正文：把 [n] 渲染成可点角标；传入 citations 时悬停/聚焦角标显示出处预览 */
export function AnswerText({ text, onCite, active, citations }: { text: string; onCite?: (n: number) => void; active?: number | null; citations?: Citation[] }) {
  const parts = text.split(/(\[\d+\])/g);
  const box = useRef<HTMLDivElement>(null);
  const [pv, setPv] = useState<{ n: number; left: number; top: number; above: boolean } | null>(null);
  const timer = useRef<number>(0);
  const show = (n: number, el: HTMLElement) => {
    if (!citations?.length || !box.current) return;
    window.clearTimeout(timer.current);
    const b = box.current.getBoundingClientRect(), r = el.getBoundingClientRect();
    const w = Math.min(260, b.width);
    const left = Math.max(0, Math.min(b.width - w, r.left - b.left - 20));
    // 以滚动容器（对话区/后台主区）的可视范围判断上下空间，预览约 190px 高；上方放不下就翻到下方
    const sc = box.current.closest('.phone-msgs, .ops-main, .sheet-list')?.getBoundingClientRect();
    const top0 = sc ? sc.top : 0, bottom0 = sc ? sc.bottom : window.innerHeight;
    const PV_H = 190;
    const spaceAbove = r.top - top0, spaceBelow = bottom0 - r.bottom;
    const above = spaceAbove >= PV_H + 8 || (spaceAbove > spaceBelow && spaceBelow < PV_H + 8);
    setPv({ n, left, top: above ? r.top - b.top - 6 : r.bottom - b.top + 6, above });
  };
  const hide = () => { timer.current = window.setTimeout(() => setPv(null), 120); };
  const c = pv ? citations?.find((x) => x.n === pv.n) : null;
  // 渲染后校正：预览实际高度超出容器时，夹回可视范围内
  const pvRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const p = pvRef.current, bx = box.current;
    if (!p || !bx) return;
    const sc = bx.closest('.phone-msgs, .ops-main, .sheet-list')?.getBoundingClientRect();
    const lo = (sc?.top ?? 0) + 4, hi = (sc?.bottom ?? window.innerHeight) - 4;
    const pr = p.getBoundingClientRect();
    let dy = 0;
    if (pr.top < lo) dy = lo - pr.top; else if (pr.bottom > hi) dy = hi - pr.bottom;
    p.style.marginTop = dy ? `${dy}px` : '';
  }, [pv]);
  return (
    <div className="answer-text" ref={box}>
      {parts.map((p, i) => {
        const m = p.match(/^\[(\d+)\]$/);
        if (m) {
          const n = +m[1];
          return (
            <button type="button" key={i} className={`cite${active === n ? ' on' : ''}`} onClick={() => { setPv(null); onCite?.(n); }} aria-label={`查看来源 ${n}`}
              onMouseEnter={(e) => show(n, e.currentTarget)} onMouseLeave={hide} onFocus={(e) => show(n, e.currentTarget)} onBlur={hide}>{n}</button>
          );
        }
        return <span key={i}>{p}</span>;
      })}
      {pv && c && (
        <div ref={pvRef} className={`cite-pv${pv.above ? ' above' : ''}`} style={{ left: pv.left, top: pv.top }} role="tooltip" onMouseEnter={() => window.clearTimeout(timer.current)} onMouseLeave={hide}>
          <div className="cite-pv-h"><span className="cite static">{c.n}</span><b>{c.docTitle}</b></div>
          <div className="cite-pv-m">v{c.version} · {c.heading}</div>
          <p>{c.snippet.length > 90 ? c.snippet.slice(0, 90) + '…' : c.snippet}</p>
          <span className="cite-pv-f">点击查看原文</span>
        </div>
      )}
    </div>
  );
}
