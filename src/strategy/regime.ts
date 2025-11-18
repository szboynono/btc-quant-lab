// src/strategy/regime.ts
import type { Candle } from "../types/candle.js";
import { ema } from "../indicators/ema.js";

/**
 * 交易周期的"趋势状态 / regime"
 * - BULL  : 明确多头趋势
 * - BEAR  : 明确空头趋势（以后做空用）
 * - RANGE : 震荡 / 不明确，不适合进场
 */
export type Regime = "BULL" | "BEAR" | "RANGE";

/**
 * 用 EMA 快/慢 + 慢 EMA 斜率 来判断当前 regime。
 * 这里不重新算 EMA，只用你已经算好的值。
 */
export function detectRegimeFromEma(
  price: number,
  emaFast: number,   // 比如 EMA50
  emaSlow: number,   // 比如 EMA200
  prevEmaSlow: number
): { regime: Regime; slopeSlow: number } {
  const slopeSlow = emaSlow - prevEmaSlow;

  let regime: Regime = "RANGE";

  if (price > emaSlow && emaFast > emaSlow && slopeSlow > 0) {
    regime = "BULL";
  } else if (price < emaSlow && emaFast < emaSlow && slopeSlow < 0) {
    regime = "BEAR";
  }

  return { regime, slopeSlow };
}

/**
 * 计算日线 K 线的 Regime 序列
 * @param candles1d 日线 K 线数组
 * @returns Regime 序列数组，每个元素包含时间和对应的 regime
 */
export function computeDailyRegimes(
  candles1d: Candle[]
): Array<{ time: number; regime: Regime }> {
  if (candles1d.length < 200) {
    return [];
  }

  const closes = candles1d.map((c) => c.close);
  const ema50 = ema(closes, 50);
  const ema200 = ema(closes, 200);

  const result: Array<{ time: number; regime: Regime }> = [];

  for (let i = 200; i < candles1d.length; i++) {
    const price = closes[i]!;
    const e50 = ema50[i]!;
    const e200 = ema200[i]!;
    const prevE200 = ema200[i - 1]!;

    const { regime } = detectRegimeFromEma(price, e50, e200, prevE200);
    result.push({
      time: candles1d[i]!.closeTime,
      regime,
    });
  }

  return result;
}