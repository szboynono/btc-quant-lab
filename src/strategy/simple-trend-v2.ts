import type { Candle } from "../types/candle.js";

export type Signal = "LONG" | "CLOSE_LONG" | "HOLD";

/**
 * Simple Trend v0.2：
 * - 只做“回踩 50EMA 后再突破”的多单
 *
 * 条件：
 * 1. 多头趋势：价格和 50EMA 都在 200EMA 上方
 * 2. 最近 lookback 根K线里，价格有明显跌破 50EMA 一小段（回踩）
 * 3. 当前这根从下向上突破 50EMA
 */
export function detectSignalV2(
  candles: Candle[],
  i: number,
  ema50: number[],
  ema200: number[],
  inPosition: boolean,
  lookback = 10,      // 向前看多少根找回踩
  retracePct = 0.003  // 回踩幅度，0.003 = 0.3%
): Signal {
  // 已在仓位中，这里的出场不交给 v2 决定
  if (inPosition) {
    return "HOLD";
  }

  // Safe: caller ensures i is in valid range [1, candles.length)
  const currentCandle = candles[i]!;
  const prevCandle = candles[i - 1]!;
  const price = currentCandle.close;
  const prevPrice = prevCandle.close;
  const e50 = ema50[i]!;
  const prevE50 = ema50[i - 1]!;
  const e200 = ema200[i]!;

  // 1) 多头趋势过滤
  const isUpTrend = price > e200 && e50 > e200;
  if (!isUpTrend) return "HOLD";

  // 2) 检查最近 N 根有没有"真正回踩"
  let hasRetrace = false;
  for (let j = i - 1; j >= 0 && j >= i - lookback; j--) {
    // Safe: j is in bounds [0, i-1] by loop condition
    const pastCandle = candles[j]!;
    const ema50j = ema50[j]!;
    if (pastCandle.close < ema50j * (1 - retracePct)) {
      hasRetrace = true;
      break;
    }
  }
  if (!hasRetrace) return "HOLD";

  // 3) 回踩后再向上突破 50EMA
  const crossUp = prevPrice <= prevE50 && price > e50;

  if (crossUp) {
    return "LONG";
  }

  return "HOLD";
}