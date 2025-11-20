// src/strategy/simple-trend-v3.ts

import type { Candle } from "../types/candle.js";

/**
 * V3: 4H 趋势策略 - 突破宽松确认版
 *
 * 信号逻辑：
 *   1) 当前K线突破：收盘 > EMA50 且 收盘 > 前高
 *   2) 下一根K线确认：下一根K线收盘 > 当前K线收盘
 *
 * 返回:
 *   "LONG" / "HOLD" / "CLOSE_LONG"
 */
export function detectSignalV3(
  candles: Candle[],
  i: number,
  ema50: number[],
  ema200: number[],
  inPosition: boolean
): "LONG" | "CLOSE_LONG" | "HOLD" {

  // 当前、前一根K、下一根
  const c0 = candles[i];
  const cPrev = candles[i - 1];
  const cNext = candles[i + 1];

  if (!c0 || !cPrev) return "HOLD";

  const price = c0.close;
  const prevHigh = cPrev.high;
  const e50 = ema50[i];
  const e200 = ema200[i];

  if (!e50 || !e200) return "HOLD";

  // ========= Step 1: 当前K线突破 =========
  const isBreakout =
    price > e50 &&
    price > e200 &&
    price > prevHigh;

  if (!isBreakout) {
    return inPosition ? "HOLD" : "HOLD";
  }

  // ========= Step 2: 宽松确认：下一根K线收盘更高 =========
  if (!cNext) {
    // 没有下一根K（刚好最新），先不下单
    return "HOLD";
  }

  const isConfirmed =
    cNext.close > c0.close;

  if (isConfirmed) {
    if (!inPosition) return "LONG";
    return "HOLD";
  }

  return "HOLD";
}