// 行级 diff（LCS）。返回 'same' | 'add' | 'del' 行序列。
export type DiffLine = { type: 'same' | 'add' | 'del'; text: string; a?: number; b?: number };

export function lineDiff(oldText: string, newText: string): DiffLine[] {
  const a = oldText.split('\n');
  const b = newText.split('\n');
  const n = a.length, m = b.length;
  // dp[i][j] = LCS(a[i:], b[j:])
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: DiffLine[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ type: 'same', text: a[i], a: i + 1, b: j + 1 }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ type: 'del', text: a[i], a: i + 1 }); i++; }
    else { out.push({ type: 'add', text: b[j], b: j + 1 }); j++; }
  }
  while (i < n) { out.push({ type: 'del', text: a[i], a: i + 1 }); i++; }
  while (j < m) { out.push({ type: 'add', text: b[j], b: j + 1 }); j++; }
  return out;
}
