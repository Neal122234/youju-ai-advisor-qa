// 中文分词（零依赖）：NFKC 归一 → 词表正向最大匹配切段 → 段内字二元组 + 词表词。
// 词表词既作为整词 token，也补其内部二元组；功能词丢弃，避免"板开""户需"这类跨词边界二元组污染 BM25。

/** 金融/投教领域词表（检索与合规共用的"主题词"信号） */
export const FINANCE_TERMS: string[] = [
  // 市场与板块
  '科创板', '创业板', '北交所', '北京证券交易所', '主板', '沪市', '深市', '沪深', '新三板', '港股通', '港股', '美股', 'A股', 'B股',
  '上交所', '深交所', '交易所', '中国结算', '证监会', '证券业协会', '基金业协会',
  // 账户与业务
  '开户', '销户', '转户', '转托管', '指定交易', '三方存管', '第三方存管', '证券账户', '资金账户', '股东账户', '账户', '身份证', '银行卡',
  '视频见证', '风险测评', '风险承受能力', '适当性', '适当性管理', '风险等级', '风险揭示书', '权限', '开通', '门槛', '资产', '日均资产',
  '交易经验', '融资融券', '两融', '股票期权', '期权', '期货', '可转债', '债券', '国债', '国债逆回购', '逆回购', '新股', '打新', '申购', '中签', '配号', '市值',
  // 交易规则
  '交易时间', '集合竞价', '连续竞价', '开盘', '收盘', '休市', '交易日', '涨跌幅', '涨跌幅限制', '涨停', '跌停', '涨跌停', '涨停板', '跌停板',
  '风险警示', '退市', '停牌', '复牌', '委托', '撤单', '申报', '成交', '交收', '清算', 'T+1', 'T+0', '印花税', '佣金', '过户费', '手续费', '规费', '经手费',
  '最低佣金', '一手', '整数倍', '零股', '大宗交易', '盘后', '盘中', '临时停牌',
  // 投教概念
  '市盈率', '市净率', '市销率', '股息率', '分红', '除权', '除息', '送转', '净资产', '净利润', '营业收入', '毛利率', '资产负债率', '现金流', '财报', '年报',
  '止损', '止盈', '仓位', '分散投资', '资产配置', '定投', '复利', '通货膨胀', '通胀', '流动性', '波动', '回撤', '最大回撤', '夏普比率', '杠杆', '爆仓',
  '平仓', '强制平仓', '维持担保比例', '保证金', '利率', '收益率', '年化', '年化收益率', '净值', '基金净值', '申购费', '赎回费', '管理费', '托管费', '赎回',
  '指数基金', '货币基金', '债券基金', '股票型基金', '混合型基金', '公募基金', '私募基金', '基金', 'ETF', 'LOF', 'QDII', 'FOF', '理财', '银行理财', '理财产品',
  '保本', '刚性兑付', '资管新规', '存款保险', '风险', '收益', '本金', '亏损', '投资者', '投资者教育', '投教',
  // 合规与风险防范
  '非法荐股', '荐股', '荐股群', '内幕交易', '内幕信息', '操纵市场', '证券欺诈', '诈骗', '骗局', '非法集资', '代客理财', '投资顾问', '投顾', '证券投资咨询',
  '投诉', '举报', '个人信息', '隐私', '密码', '交易密码', '资金密码', '验证码', '冷静期', '回访',
];

/** 丢弃的功能词（多字优先匹配）。单字只收无实义的语气/指代字。 */
const STOP_MULTI = [
  '请问', '什么', '怎么', '怎样', '怎么样', '如何', '哪些', '哪个', '哪里', '为什么', '为何', '可以', '能否', '是否', '需要', '一下', '一个', '有没有', '没有',
  '告诉', '知道', '了解', '我们', '你们', '他们', '这个', '那个', '这些', '那些', '就是', '还是', '或者', '以及', '但是', '然后', '因为', '所以', '如果',
  '现在', '一般', '时候', '东西', '相关', '情况', '问题', '是不是', '能不能', '可不可以', '想问', '问问', '请教', '多少', '的话',
];
const STOP_SINGLE = new Set('的了吗呢吧啊呀么嘛哦啦我你您和与及或这那请是在有要想能会就都也还又把被让给对从向'.split(''));

const DICT = new Set<string>();
const STOP = new Set<string>(STOP_MULTI);
let MAXLEN = 1;
function addWords(ws: string[], target: Set<string>) {
  for (const w of ws) { const n = normalizeText(w); target.add(n); if (n.length > MAXLEN) MAXLEN = n.length; }
}

/** 全角→半角、繁简不处理、大写→小写 */
export function normalizeText(s: string): string {
  return (s || '').normalize('NFKC').toLowerCase();
}

addWords(FINANCE_TERMS, DICT);
addWords(STOP_MULTI, STOP);

/** 允许运行期扩充词表（如 build-kb 把 tags 加入） */
export function extendDictionary(words: string[]) { addWords(words.filter((w) => w && w.length >= 2 && w.length <= 10), DICT); }

const CJK = /[㐀-鿿]/;
const RUN = /[㐀-鿿]+|[a-z0-9]+(?:[.+][a-z0-9]+)*/g;

export function bigramsOf(seg: string): string[] {
  if (seg.length < 2) return seg ? [seg] : [];
  const out: string[] = [];
  for (let i = 0; i < seg.length - 1; i++) out.push(seg.slice(i, i + 2));
  return out;
}

/** 检索用分词：返回 token 列表（含重复，用于 tf） */
export function tokenize(text: string): string[] {
  const s = normalizeText(text);
  const out: string[] = [];
  RUN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RUN.exec(s))) {
    const run = m[0];
    if (!CJK.test(run[0])) { if (run.length >= 1) out.push(run); continue; }
    let free = '';
    const flush = () => { if (free) { out.push(...bigramsOf(free)); free = ''; } };
    let i = 0;
    while (i < run.length) {
      let matched = '';
      let kind: 'dict' | 'stop' | '' = '';
      for (let L = Math.min(MAXLEN, run.length - i); L >= 2; L--) {
        const w = run.slice(i, i + L);
        if (DICT.has(w)) { matched = w; kind = 'dict'; break; }
        if (STOP.has(w)) { matched = w; kind = 'stop'; break; }
      }
      if (kind === 'dict') {
        flush(); out.push(matched); if (matched.length >= 3) out.push(...bigramsOf(matched)); i += matched.length; continue;
      }
      if (kind === 'stop') { flush(); i += matched.length; continue; }
      const ch = run[i];
      if (STOP_SINGLE.has(ch)) { flush(); i++; continue; }
      free += ch; i++;
    }
    flush();
  }
  return out;
}

/** 字二元组集合（grounding / gap 归并用，不做词表切分） */
export function charBigramSet(text: string): Set<string> {
  const s = normalizeText(text).replace(/[^㐀-鿿a-z0-9]/g, '');
  const set = new Set<string>();
  if (s.length === 1) set.add(s);
  for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
  return set;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/** 文本中出现的领域词（合规"主题信号"） */
export function financeTermsIn(text: string): string[] {
  const s = normalizeText(text);
  const found: string[] = [];
  for (const w of DICT) if (w.length >= 2 && s.includes(w)) found.push(w);
  return found;
}
