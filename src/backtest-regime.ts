// src/backtest-regime.ts
import type { Candle } from "./types/candle.js";
import {
  backtestSimpleBtcTrend,
  type RegimeType,
} from "./backtest/engine.js";
import { ema } from "./indicators/ema.js";
import { detectRegimeFromEma } from "./strategy/regime.js";

// 用 strategy.json 的结构做个接口，方便 TS 提示
export interface StrategyConfig {
  useTrendFilter?: boolean;
  useV2Signal?: boolean;
  useV3Signal?: boolean;
  stopLossPct?: number;
  takeProfitPct?: number;
  minAtrPct?: number;
  maxRsiForEntry?: number;
  minRsiForEntry?: number;
  rsiPeriod?: number;             // ✅ 新增：RSI 周期
  maxPremiumOverEma50?: number;   // ✅ 新增：不追高最大溢价
}

/**
 * 统一入口：
 * 给 4H / 1D K线 + 策略参数 → 跑一遍“带日线 Regime 过滤”的回测
 */
export function runBacktestWithConfig(
  candles4h: Candle[],
  candles1d: Candle[],
  cfg: StrategyConfig
) {
  if (candles4h.length < 200 || candles1d.length < 200) {
    return null;
  }

  // === 日线 Regime 计算（和 index-backtest-regime 里的一样） ===
  const dailyCloses = candles1d.map((c) => c.close);
  const dEma50 = ema(dailyCloses, 50);
  const dEma200 = ema(dailyCloses, 200);

  const dailyTimes: number[] = [];
  const dailyRegimes: RegimeType[] = [];

  for (let i = 200; i < candles1d.length; i++) {
    const price = dailyCloses[i]!;
    const e50 = dEma50[i]!;
    const e200 = dEma200[i]!;
    const prevE200 = dEma200[i - 1]!;

    const { regime } = detectRegimeFromEma(price, e50, e200, prevE200);

    dailyTimes.push(candles1d[i]!.closeTime);
    dailyRegimes.push(regime);
  }

  // === 真正回测：带 higherTFRegime + 只允许 BULL ===
  const result = backtestSimpleBtcTrend(candles4h, {
    useTrendFilter: cfg.useTrendFilter ?? true,
    useV2Signal: cfg.useV2Signal ?? false,
    useV3Signal: cfg.useV3Signal ?? false,

    // 👉 默认值改成和你现在实盘/strategy.json 一致
    stopLossPct: cfg.stopLossPct ?? 0.008,
    takeProfitPct: cfg.takeProfitPct ?? 0.04,
    minAtrPct: cfg.minAtrPct ?? 0.007,

    maxRsiForEntry: cfg.maxRsiForEntry ?? 75,
    minRsiForEntry: cfg.minRsiForEntry ?? 30,

    // ✅ 补上传递 RSI 周期 & 不追高参数
    rsiPeriod: cfg.rsiPeriod ?? 14,
    maxPremiumOverEma50: cfg.maxPremiumOverEma50 ?? 0.05,

    higherTFRegime: {
      times: dailyTimes,
      regimes: dailyRegimes,
    },
    allowedHigherTFRegimes: ["BULL"],
  });

  return {
    result,
    dailyTimes,
    dailyRegimes,
  };
}