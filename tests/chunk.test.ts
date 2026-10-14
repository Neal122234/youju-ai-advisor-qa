/// <reference types="node" />
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildFrontMatter, chunkDocument, normalizeMeta, parseFrontMatter, splitSentences, MAX_CHUNK_CHARS } from '../core/chunk';

const fx = (f: string) => readFileSync(join(__dirname, 'fixtures/kb', f), 'utf8');

describe('parseFrontMatter', () => {
  it('解析标量、数组、null、行内注释', () => {
    const { meta, body } = parseFrontMatter(fx('fx-star-market.md'));
    expect(meta.doc_key).toBe('fx-star-market');
    expect(meta.product_risk).toBe('R4');
    expect(meta.tags).toEqual(['科创板', '权限', '门槛']);
    expect(body.startsWith('# 一级标题')).toBe(true);
  });
  it('支持 "- item" 列表与 null', () => {
    const { meta } = parseFrontMatter(fx('fx-long.md'));
    expect(meta.tags).toEqual(['切分', '测试']);
    expect(meta.product_risk).toBeNull();
  });
  it('无 front-matter 时原样返回正文', () => {
    const r = parseFrontMatter('## 标题\n正文');
    expect(r.meta).toEqual({});
    expect(r.body).toBe('## 标题\n正文');
  });
  it('normalizeMeta 校验风险等级并补缺省值', () => {
    const m = normalizeMeta({ product_risk: 'r9', tags: 'a, b' }, 'k');
    expect(m.product_risk).toBeNull();
    expect(m.tags).toEqual(['a', 'b']);
    expect(m.category).toBe('investor_edu');
  });
  it('buildFrontMatter 与 parseFrontMatter 往返一致', () => {
    const fm = buildFrontMatter({ doc_key: 'x-1', title: '标题', category: 'product_rule', product_risk: 'R3', tags: ['甲', '乙'] });
    const { meta } = parseFrontMatter(fm + '## a\nb');
    expect(normalizeMeta(meta)).toMatchObject({ doc_key: 'x-1', product_risk: 'R3', tags: ['甲', '乙'] });
  });
});

describe('chunkDocument', () => {
  it('按 ## 切分、一级标题不入正文、id 格式正确', () => {
    const cs = chunkDocument(fx('fx-star-market.md'), { version: 3 });
    expect(cs.map((c) => c.heading)).toEqual(['开通条件', '风险等级']);
    expect(cs[0].id).toBe('fx-star-market@v3#0');
    expect(cs[1].id).toBe('fx-star-market@v3#1');
    expect(cs[0].productRisk).toBe('R4');
    expect(cs.every((c) => !c.text.includes('一级标题'))).toBe(true);
  });
  it('单块 >400 字按句切，块间 overlap 1 句，且每块 ≤400', () => {
    const cs = chunkDocument(fx('fx-long.md'));
    const long = cs.filter((c) => c.heading === '很长的小节');
    expect(long.length).toBeGreaterThan(1);
    for (const c of long) expect(c.text.length).toBeLessThanOrEqual(MAX_CHUNK_CHARS);
    for (let i = 1; i < long.length; i++) {
      const prevLast = splitSentences(long[i - 1].text).pop()!;
      expect(long[i].text.startsWith(prevLast)).toBe(true);
    }
    expect(cs[cs.length - 1].heading).toBe('短小节');
    expect(cs.map((c) => c.ord)).toEqual(cs.map((_, i) => i));
  });
  it('meta 参数覆盖 front-matter', () => {
    const cs = chunkDocument(fx('fx-star-market.md'), { docKey: 'k', title: 'T', productRisk: null, version: 2 });
    expect(cs[0]).toMatchObject({ id: 'k@v2#0', docKey: 'k', docTitle: 'T', productRisk: null });
  });
  it('无 ## 小标题时用文档标题作为小标题；空文档返回空数组', () => {
    expect(chunkDocument('---\ntitle: 无标题\n---\n一段正文。')[0].heading).toBe('无标题');
    expect(chunkDocument('')).toEqual([]);
  });
  it('超长单句硬切', () => {
    const cs = chunkDocument('## a\n' + '字'.repeat(1000));
    expect(cs.length).toBe(3);
    expect(cs.every((c) => c.text.length <= 400)).toBe(true);
  });
});
