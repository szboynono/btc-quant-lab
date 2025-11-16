// src/strategy/mean-revert.ts
import type { Candle } from "../types/candle.js";

export type MRSignal = "LONG" | "CLOSE_LONG" | "HOLD";

export interface MeanRevertSignalParams {
  bandKEnter: number; // 进场带宽倍数，例如 2.0 = 价格 < EMA20 - 2 * ATR
  bandKExit: number;  // 出场带宽倍数，例如 0.5 = 价格回到 EMA20 - 0.5 * ATR 上方就走
}

/**
 * 均值回归信号（只做多）：
 * - 不在仓位：价格 < EMA20 - bandKEnter * ATR -> LONG
 * - 在仓位： 价格 >= EMA20 - bandKExit * ATR -> CLOSE_LONG
 */
export function detectMeanRevertSignal(
  candles: Candle[],
  i: number,
  ema20: number[],
  atr14: number[],
  inPosition: boolean,
  params: MeanRevertSignalParams
): MRSignal {
  const candle = candles[i];
  if (!candle) {
    return "HOLD";
  }

  const price = candle.close;
  const ema = ema20[i];
  const atr = atr14[i];
  const { bandKEnter, bandKExit } = params;

  if (ema === undefined || atr === undefined || !Number.isFinite(ema) || !Number.isFinite(atr)) {
    return "HOLD";
  }

  const lowerEnter = ema - bandKEnter * atr;
  const lowerExit = ema - bandKExit * atr;

  if (!inPosition) {
    // 足够深的“超跌”才进场
    if (price < lowerEnter) return "LONG";
    return "HOLD";
  } else {
    // 反弹回血到靠近均线就退出
    if (price >= lowerExit) return "CLOSE_LONG";
    return "HOLD";
  }
}
