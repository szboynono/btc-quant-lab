// src/risk/position-sizing.ts

export type Regime = "BULL" | "RANGE" | "BEAR";

export interface PositionSizingConfig {
  /**
   * BULL / RANGE / BEAR 下的基础仓位系数
   * - 比如 BULL: 1.0, RANGE: 0.5, BEAR: 0 表示
   *   BULL 用 100% 标准仓位，RANGE 用 50%，BEAR 不开
   */
  regimeBaseFactor: Record<Regime, number>;

  /**
   * 连续亏损时，额外缩放的系数
   * key = 连续亏损次数，value = 在此档位下的乘数
   * 实际逻辑：找到 <= 当前 losingStreak 的最大 key
   */
  losingStreakFactor: Record<number, number>;

  /**
   * 最小 / 最大仓位系数
   */
  minFactor: number;
  maxFactor: number;
}

/**
 * 默认使用“专业交易员模式 B”：
 * - BULL: 1.0
 * - RANGE: 0.5
 * - BEAR: 0
 * - 连续 0~1 次亏损：1.0
 * - 连续 2 次亏损：0.8
 * - 连续 3 次亏损：0.6
 * - 连续 4+ 次亏损：0.4
 */
export const defaultPositionConfig: PositionSizingConfig = {
  regimeBaseFactor: {
    BULL: 1.0,
    RANGE: 0.5,
    BEAR: 0,
  },
  losingStreakFactor: {
    0: 1.0,
    1: 1.0,
    2: 0.8,
    3: 0.6,
    4: 0.4,
  },
  minFactor: 0,
  maxFactor: 1.0,
};

/**
 * 计算仓位系数（0 ~ 1），不依赖账户余额
 *
 * @param regime        当前日线 Regime（来自你的日线 EMA 判断）
 * @param losingStreak  当前连续止损次数（只统计 SL）
 * @param config        配置，不传则用默认 defaultPositionConfig
 *
 * 用法：
 *   const factor = calcPositionFactor(regime, losingStreak);
 *   const notional = BASE_NOTIONAL_USDT * factor;
 */
export function calcPositionFactor(
  regime: Regime,
  losingStreak: number,
  config: PositionSizingConfig = defaultPositionConfig
): number {
  // 1. Regime 基础系数
  const base = config.regimeBaseFactor[regime] ?? 0;

  // BEAR 直接拦截
  if (base <= 0) {
    return 0;
  }

  // 2. 找到 <= 当前 losingStreak 的最大档位
  let streakFactor = 1.0;
  const keys = Object.keys(config.losingStreakFactor)
    .map((k) => Number(k))
    .sort((a, b) => a - b);

  for (const k of keys) {
    if (losingStreak >= k) {
      streakFactor = config.losingStreakFactor[k]!;
    } else {
      break;
    }
  }

  let factor = base * streakFactor;

  // 3. clamp 到 min/max
  factor = Math.max(config.minFactor, Math.min(config.maxFactor, factor));

  // 稍微规整一下小数
  return Number(factor.toFixed(2));
}

/**
 * 根据 Regime 从 leverageLevels 中选一个杠杆
 * - 通常 leverageLevels = [3, 5]
 * - BULL 用高杠杆，RANGE 用低杠杆，BEAR 返回 0（表示不做）
 */
export function pickLeverageByRegime(
  regime: Regime,
  leverageLevels: number[]
): number {
  if (!leverageLevels.length) return 0;

  const sorted = [...leverageLevels].sort((a, b) => a - b);
  const low = sorted[0]!;
  const high = sorted[sorted.length - 1]!;

  if (regime === "BEAR") return 0;
  if (regime === "RANGE") return low;
  return high; // BULL
}