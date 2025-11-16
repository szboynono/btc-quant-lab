import type { Candle } from "../types/candle.js";

export function atr(candles: Candle[], period = 14): number[] {
  if (candles.length === 0) return [];

  const result: number[] = new Array(candles.length).fill(NaN);

  // Safe: we checked length > 0 above
  const firstCandle = candles[0]!;
  let prevClose = firstCandle.close;
  let trSum = 0;

  for (let i = 1; i < candles.length; i++) {
    // Safe: i is guaranteed to be in bounds by the loop condition
    const c = candles[i]!;
    const high = c.high;
    const low = c.low;

    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );

    prevClose = c.close;

    if (i <= period) {
      trSum += tr;
      if (i === period) {
        result[i] = trSum / period;
      }
    } else {
      // 简单的 Wilder 平滑
      // Safe: i > period, so i - 1 >= period, and we set result[period] above
      const prevAtr = result[i - 1]!;
      result[i] = (prevAtr * (period - 1) + tr) / period;
    }
  }

  return result;
}