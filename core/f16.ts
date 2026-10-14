// 向量的 float16 + base64 编解码（零依赖，Worker / Node / 浏览器通用）。
// 取舍：bge-m3 输出已 L2 归一化，分量绝对值 < 1；float16 有效精度约 3 位十进制，
// 余弦相似度误差在 1e-3 量级，对 top-k 排序几乎无影响；体积为 JSON 浮点（约 8 字节/分量）的 1/3 左右。

function f32ToF16(val: number): number {
  const f = new Float32Array(1); const u = new Uint32Array(f.buffer);
  f[0] = val; const x = u[0];
  const sign = (x >>> 16) & 0x8000;
  let exp = ((x >>> 23) & 0xff) - 127 + 15;
  let mant = x & 0x7fffff;
  if (exp <= 0) {                                   // 次正规数 / 下溢
    if (exp < -10) return sign;
    mant = (mant | 0x800000) >> (1 - exp);
    return sign | ((mant + 0x1000) >> 13);
  }
  if (exp >= 0x1f) return sign | 0x7c00;            // 上溢 → Inf
  const r = sign | (exp << 10) | ((mant + 0x1000) >> 13);
  return r;
}
function f16ToF32(h: number): number {
  const sign = h & 0x8000 ? -1 : 1;
  const exp = (h >> 10) & 0x1f; const mant = h & 0x3ff;
  if (exp === 0) return sign * Math.pow(2, -14) * (mant / 1024);
  if (exp === 0x1f) return mant ? NaN : sign * Infinity;
  return sign * Math.pow(2, exp - 15) * (1 + mant / 1024);
}

const B64 = typeof btoa === 'function' ? btoa : (s: string) => Buffer.from(s, 'binary').toString('base64');
const UNB64 = typeof atob === 'function' ? atob : (s: string) => Buffer.from(s, 'base64').toString('binary');
declare const Buffer: { from(s: string, enc: string): { toString(enc: string): string } };

export function encodeF16Base64(vec: ArrayLike<number>): string {
  let bin = '';
  for (let i = 0; i < vec.length; i++) { const h = f32ToF16(vec[i]); bin += String.fromCharCode(h & 0xff, h >> 8); }
  return B64(bin);
}
export function decodeF16Base64(b64: string): number[] {
  const bin = UNB64(b64); const out = new Array(bin.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = f16ToF32(bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8));
  return out;
}

/** 块内容指纹（FNV-1a 32 位）：知识内容变了就不复用旧向量 */
export function chunkFingerprint(heading: string, text: string): string {
  let h = 0x811c9dc5;
  const s = `${heading}\n${text}`;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export interface EmbeddingBundle {
  model: string; dims: number; format: 'f16-base64'; exportedAt: string; source: string;
  chunks: Record<string, { fp: string; v: string }>;
}
