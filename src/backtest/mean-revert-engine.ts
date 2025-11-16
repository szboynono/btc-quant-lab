// src/backtest/mean-revert-engine.ts
import type { Candle, Trade } from "../types/candle.js";
import { ema } from "../indicators/ema.js";
import { atr } from "../indicators/atr.js";
import {
  detectMeanRevertSignal,
  type MeanRevertSignalParams,
  type MRSignal,
} from "../strategy/mean-revert.js";

export interface BacktestResultMR {
  totalTrades: number;
  totalReturnPct: number;
  avgReturnPct: number;
  winRate: number;
  trades: Trade[];
}

export interface MeanRevertOptions {
  stopLossPct?: number;   // 止损百分比
  takeProfitPct?: number; // 止盈百分比
  bandKEnter?: number;    // 进场带宽倍数
  bandKExit?: number;     // 出场带宽倍数
  minAtrPct?: number;     // 最小 ATR 波动率（ATR / price）
}

// 手续费（单边）
const feeRate = 0.0004;

/**
 * BTC 4H 均值回归回测（只做多）
 */
export function backtestBtcMeanRevert(
  candles: Candle[],
  options: MeanRevertOptions = {}
): BacktestResultMR | null {
  const {
    stopLossPct = 0.015,   // 比趋势策略稍微紧一点
    takeProfitPct = 0.03,  // 反弹就跑，不贪太多
    bandKEnter = 2.0,      // 跌到 EMA20 - 2*ATR 才敢接
    bandKExit = 0.5,       // 反弹回 EMA20 - 0.5*ATR 就走
    minAtrPct = 0.005,     // ATR 至少 0.5% 波动才玩
  } = options;

  if (candles.length < 100) {
    console.log("K线太少，至少需要100根以上。");
    return null;
  }

  const closes = candles.map((c) => c.close);
  const ema20 = ema(closes, 20);
  const atr14 = atr(candles, 14);

  let inPosition = false;
  let entryPrice = 0;
  let entryTime = 0;

  const trades: Trade[] = [];

  // 从第 50 根以后开始（保证 EMA/ATR 都“热”起来）
  for (let i = 50; i < candles.length; i++) {
    const c = candles[i]!;
    const price = c.close;
    const { high, low } = c;

    const emaVal = ema20[i];
    const atrVal = atr14[i];
    if (!Number.isFinite(emaVal) || !Number.isFinite(atrVal)) {
      continue;
    }

    // Safety: atrVal may be undefined if ATR data is not ready
    if (typeof atrVal !== "number" || !Number.isFinite(atrVal)) {
      continue;
    }

    const atrPct = atrVal / price;
    if (atrPct < minAtrPct) {
      // 波动太小，不玩
      continue;
    }

    if (!inPosition) {
      const signal: MRSignal = detectMeanRevertSignal(
        candles,
        i,
        ema20,
        atr14,
        inPosition,
        { bandKEnter, bandKExit }
      );

      if (signal === "LONG") {
        inPosition = true;
        entryPrice = price;
        entryTime = c.closeTime;
      }
    } else {
      // 持仓：优先看止损 / 止盈，再看均值退出
      const stopPrice = entryPrice * (1 - stopLossPct);
      const tpPrice = entryPrice * (1 + takeProfitPct);

      let shouldExit = false;
      let exitPrice = price;
      let exitReason: "SL" | "TP" | "EMA" = "EMA";

      // 1) 止损优先
      if (low <= stopPrice) {
        shouldExit = true;
        exitPrice = stopPrice;
        exitReason = "SL";
      }
      // 2) 止盈
      else if (high >= tpPrice) {
        shouldExit = true;
        exitPrice = tpPrice;
        exitReason = "TP";
      }
      // 3) 均值回归退出
      else {
        const signal: MRSignal = detectMeanRevertSignal(
          candles,
          i,
          ema20,
          atr14,
          inPosition,
          { bandKEnter, bandKExit }
        );
        if (signal === "CLOSE_LONG") {
          shouldExit = true;
          exitPrice = price;
          exitReason = "EMA"; // 这里用 EMA 代表“均值退出”
        }
      }

      if (shouldExit) {
        const exitTime = c.closeTime;

        const grossPnlPct = ((exitPrice - entryPrice) / entryPrice) * 100;
        const feePct = feeRate * 2 * 100;
        const pnlPct = grossPnlPct - feePct;

        trades.push({
          entryTime,
          exitTime,
          entryPrice,
          exitPrice,
          pnlPct,
          exitReason,
        });

        inPosition = false;
      }
    }
  }

  // 最后一笔强平（如果还在仓位）
  if (inPosition) {
    const last = candles[candles.length - 1]!;
    const exitPrice = last.close;
    const exitTime = last.closeTime;

    const grossPnlPct = ((exitPrice - entryPrice) / entryPrice) * 100;
    const feePct = feeRate * 2 * 100;
    const pnlPct = grossPnlPct - feePct;

    trades.push({
      entryTime,
      exitTime,
      entryPrice,
      exitPrice,
      pnlPct,
      exitReason: "EMA",
    });
  }

  const totalTrades = trades.length;
  const totalReturnPct = trades.reduce((sum, t) => sum + t.pnlPct, 0);
  const avgReturnPct = totalTrades > 0 ? totalReturnPct / totalTrades : 0;
  const wins = trades.filter((t) => t.pnlPct > 0);
  const winRate = totalTrades > 0 ? (wins.length / totalTrades) * 100 : 0;

  return {
    totalTrades,
    totalReturnPct,
    avgReturnPct,
    winRate,
    trades,
  };
}

/**
 * 打印均值回归策略结果
 */
export function printBacktestResultMR(
  result: BacktestResultMR,
  candleCount: number
): void {
  console.log("=== BTC 均值回归策略回测（含手续费） ===");
  console.log("K线数量:", candleCount);
  console.log("交易笔数:", result.totalTrades);
  console.log("总收益:", result.totalReturnPct.toFixed(2), "%");
  console.log("平均每笔收益:", result.avgReturnPct.toFixed(2), "%");
  console.log("胜率:", result.winRate.toFixed(2), "%");

  const slCount = result.trades.filter((t) => t.exitReason === "SL").length;
  const tpCount = result.trades.filter((t) => t.exitReason === "TP").length;
  const emaCount = result.trades.filter((t) => t.exitReason === "EMA").length;

  console.log("退出方式统计:", {
    SL: slCount,
    TP: tpCount,
    MEAN: emaCount,
  });

  console.log("前几笔交易示例:");
  console.log(
    result.trades.slice(0, 5).map((t) => ({
      entry: new Date(t.entryTime).toISOString(),
      exit: new Date(t.exitTime).toISOString(),
      entryPrice: t.entryPrice,
      exitPrice: t.exitPrice,
      pnlPct: t.pnlPct.toFixed(2) + "%",
      exitReason: t.exitReason,
    }))
  );
}
