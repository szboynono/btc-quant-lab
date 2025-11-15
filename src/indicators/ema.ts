/**
 * 简单EMA计算
 * @param values - 价格序列
 * @param period - 周期
 * @returns EMA序列
 */
export function ema(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const result: number[] = [];
  // Safe: we checked length > 0 above
  const firstValue = values[0]!;
  let prev = firstValue;
  result.push(prev);
  for (let i = 1; i < values.length; i++) {
    // Safe: i is guaranteed to be in bounds by the loop condition
    const currentValue = values[i]!;
    const v = currentValue * k + prev * (1 - k);
    result.push(v);
    prev = v;
  }
  return result;
}
