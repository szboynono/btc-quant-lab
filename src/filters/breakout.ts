// src/filters/breakout.ts
import type { Candle } from "../types/candle.js";

export function isBreakout(candles: Candle[], i: number): boolean {
  const lookback = 30; // 大约 5 天

  if (i < lookback * 2) return false;

  let recentHigh = -Infinity;
  let prevHigh = -Infinity;

  // Use optional chaining and extra bounds checking to ensure safety
  for (let k = i - lookback + 1; k <= i; k++) {
    const high = candles[k]?.high;
    if (typeof high === "number") {
      recentHigh = Math.max(recentHigh, high);
    }
  }

  for (let k = i - lookback * 2 + 1; k <= i - lookback; k++) {
    const high = candles[k]?.high;
    if (typeof high === "number") {
      prevHigh = Math.max(prevHigh, high);
    }
  }

  return recentHigh > prevHigh * 1.01; // 超过前箱体 1%
}