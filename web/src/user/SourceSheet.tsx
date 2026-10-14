import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import type { Citation } from '../apiTypes';
import { Icon } from '../ui/kit';

/** 答案里引用了 [n] 的句子（去掉角标），用于在原文里高亮被引用的片段 */
function citedSentences(answer: string, n: number): string {
  // 句末标点后紧跟的角标归属前一句（"……条件。[1]"）
  return (answer.match(/[^。！？；\n]+[。！？；\n]*(?:\s*\[\d+\])*/g) ?? [])
    .filter((s) => s.includes(`[${n}]`))
    .map((s) => s.replace(/\[\d+\]/g, ''))
    .join('');
}

/** 原文中与引用句重合 ≥ 6 字的连续片段标记为高亮 */
export function highlightRanges(snippet: string, src: string, min = 6): [number, number][] {
  if (!src) return [];
  const out: [number, number][] = [];
  let i = 0;
  while (i < snippet.length) {
    let k = 0;
    while (i + k < snippet.length && src.includes(snippet.slice(i, i + k + 1))) k++;
    if (k >= min) { out.push([i, i + k]); i += k; } else i++;
  }
  return out;
}

function Marked({ text, ranges }: { text: string; ranges: [number, number][] }) {
  if (!ranges.length) return <>{text}</>;
  const parts: ReactNode[] = [];
  let p = 0;
  ranges.forEach(([a, b], i) => { if (a > p) parts.push(text.slice(p, a)); parts.push(<mark key={i} className="hl">{text.slice(a, b)}</mark>); p = b; });
  if (p < text.length) parts.push(text.slice(p));
  return <>{parts}</>;
}

export function SourceSheet({ citations, answer, active, onClose }: { citations: Citation[]; answer: string; active: number | null; onClose: () => void }) {
  const listRef = useRef<HTMLOListElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const marks = useMemo(() => citations.map((c) => highlightRanges(c.snippet, citedSentences(answer, c.n))), [citations, answer]);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', k, true);
    return () => { window.removeEventListener('keydown', k, true); prev?.focus?.(); };
  }, [onClose]);
  useEffect(() => {
    if (active == null) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-n="${active}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [active]);
  return (
    <div className="sheet-wrap" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label="回答出处" tabIndex={-1} ref={panelRef}>
        <div className="sheet-grip" aria-hidden="true" />
        <div className="sheet-h">
          <div><b>回答出处</b><span className="muted small">共 {citations.length} 处，均来自示例证券知识库</span></div>
          <button className="icon-btn" onClick={onClose} aria-label="关闭出处"><Icon name="x" /></button>
        </div>
        <ol className="sheet-list" ref={listRef}>
          {citations.map((c, i) => (
            <li key={c.n} data-n={c.n} className={active === c.n ? 'on' : ''}>
              <div className="sh-head">
                <span className="cite static">{c.n}</span>
                <div className="sh-title"><b>{c.docTitle}</b><span className="muted small">第 {c.version} 版 · {c.heading}</span></div>
              </div>
              <blockquote><Marked text={c.snippet} ranges={marks[i]} /></blockquote>
            </li>
          ))}
        </ol>
        <p className="sheet-foot muted small">高亮部分为回答引用的原文；规则以交易所和监管部门最新发布为准。</p>
      </div>
    </div>
  );
}
