/// <reference types="node" />
// 用户端推荐追问 / 常见问题：措辞不能触发输入合规规则（否则系统自己推荐的问题会被拒答或建工单）
import { describe, expect, it } from 'vitest';
import { analyzeInput } from '../core/compliance';
import { ALL_SUGGESTIONS, renumberCitations } from '../web/src/user/suggest';
import type { ChatResponse } from '../core/types';

// 有意保留的转人工入口
const INTENDED_HANDOFF = new Set(['我要投诉，转人工']);

describe('推荐问题措辞', () => {
  for (const q of ALL_SUGGESTIONS.filter((x) => !INTENDED_HANDOFF.has(x))) {
    it(q, () => {
      const a = analyzeInput(q);
      expect(a.verdict, `${q} → ${a.verdict} ${a.hits.map((h) => h.category).join(',')}`).toBe('clean');
      // 线上意图分类会把这些词判为要人工/越界（2026-10-14 实测），推荐语里不用
      expect(q).not.toMatch(/客服|投诉|人工|还能买|会涨|能不能买/);
    });
  }
});

describe('引用重新编号', () => {
  const base = { citations: [
    { n: 2, chunkId: 'a', docKey: 'a', docTitle: 'A', version: 1, heading: 'h', snippet: 's' },
    { n: 5, chunkId: 'b', docKey: 'b', docTitle: 'B', version: 1, heading: 'h', snippet: 's' },
    { n: 1, chunkId: 'c', docKey: 'c', docTitle: 'C', version: 1, heading: 'h', snippet: 's' },
  ] } as unknown as ChatResponse;
  it('按正文首次出现顺序连续编号，未引用的排在后面', () => {
    const r = renumberCitations({ ...base, answer: '甲[5]。乙[2][5]。' });
    expect(r.answer).toBe('甲[1]。乙[2][1]。');
    expect(r.citations.map((c) => [c.n, c.docKey])).toEqual([[1, 'b'], [2, 'a'], [3, 'c']]);
  });
});
