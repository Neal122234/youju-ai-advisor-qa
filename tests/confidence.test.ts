import { describe, expect, it } from 'vitest';
import { computeConfidence, computeGrounding, decideByConfidence, extractCitations, matchSuitability, maxProductRisk, normalizeRetrieval, validateCitations } from '../core/confidence';
import { fixtureChunks } from './helpers/mocks';

describe('置信度分档', () => {
  it('权重 0.35/0.25/0.25/0.15', () => {
    expect(computeConfidence({ retrieval: 1, coverage: 1, grounding: 1, citation: 1 })).toBe(1);
    expect(computeConfidence({ retrieval: 1, coverage: 0, grounding: 0, citation: 0 })).toBe(0.35);
    expect(computeConfidence({ retrieval: 0.5, coverage: 0.3, grounding: 0.6, citation: 1 })).toBeCloseTo(0.175 + 0.075 + 0.15 + 0.15, 3);
  });
  it('边界：≥0.62 answered，0.45–0.62 caveat，<0.45 low_conf', () => {
    expect(decideByConfidence(0.62)).toBe('answered');
    expect(decideByConfidence(0.6199)).toBe('answered_caveat');
    expect(decideByConfidence(0.45)).toBe('answered_caveat');
    expect(decideByConfidence(0.4499)).toBe('handoff_low_conf');
  });
  it('检索分归一化（hybrid/keyword 不同区间，截断到 0..1）', () => {
    expect(normalizeRetrieval(0.3, 'hybrid')).toBe(0);
    expect(normalizeRetrieval(0.75, 'hybrid')).toBe(1);
    expect(normalizeRetrieval(0.9, 'keyword')).toBe(1);
    expect(normalizeRetrieval(0.45, 'keyword')).toBe(0.5);
  });
});

describe('引用校验', () => {
  it('抽取 [1] [1,2] 【3】', () => { expect(extractCitations('a[1]b[1,2]c【3】')).toEqual([1, 1, 2, 3]); });
  it('剔除越界引用并计分', () => {
    const r = validateCitations('科创板需要 50 万资产[1]。还要 24 个月经验[7]。', 3);
    expect(r.valid).toEqual([1]);
    expect(r.invalid).toEqual([7]);
    expect(r.cleaned).not.toContain('[7]');
    expect(r.score).toBeGreaterThan(0);
    expect(r.score).toBeLessThan(1);
  });
  it('无引用 → 0 分；全部合法且每句有引用 → 1 分', () => {
    expect(validateCitations('科创板需要五十万资产。', 2).score).toBe(0);
    expect(validateCitations('科创板需要五十万资产[1]。交易经验要二十四个月[2]。', 2).score).toBe(1);
  });
});

describe('grounding', () => {
  const chunks = fixtureChunks();
  it('照抄原文 ≈1，编造内容 ≈0', () => {
    const copy = `${chunks[0].text.slice(0, 40)}[1]。`;
    expect(computeGrounding(copy, chunks)).toBeGreaterThan(0.9);
    expect(computeGrounding('火星殖民计划明年启动并发放船票[1]。', chunks)).toBeLessThan(0.2);
    expect(computeGrounding('', chunks)).toBe(0);
  });
});

describe('适当性比对', () => {
  it('C≥R 才匹配', () => {
    expect(matchSuitability('C4', 'R4')).toBe(true);
    expect(matchSuitability('C2', 'R4')).toBe(false);
    expect(matchSuitability('C5', 'R1')).toBe(true);
    expect(matchSuitability('C1', 'R2')).toBe(false);
  });
  it('取最高风险等级', () => {
    const cs = fixtureChunks();
    expect(maxProductRisk(cs)).toBe('R4');
    expect(maxProductRisk(cs.filter((c) => !c.productRisk))).toBeNull();
  });
});
