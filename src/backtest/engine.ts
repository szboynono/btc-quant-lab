import type { Candle, Trade } from "../types/candle.js";
import { ema } from "../indicators/ema.js";
import { detectSignal } from "../strategy/simple-trend.js";
import { detectSignalV2 } from "../strategy/simple-trend-v2.js";
import { atr } from "../indicators/atr.js";

/**
 * 回测统计结果
 */
export interface BacktestResult {
  totalTrades: number;
  totalReturnPct: number;
  avgReturnPct: number;
  winRate: number;
  trades: Trade[];
}

/**
 * 回测参数配置
 */
export interface BacktestOptions {
  useTrendFilter?: boolean; // 是否使用 200EMA 多头过滤 + 强度过滤
  stopLossPct?: number; // 止损百分比
  takeProfitPct?: number; // 止盈百分比
  useV2Signal?: boolean; // 是否使用 V2 信号
  minAtrPct?: number; // ✅ 最小 ATR 波动率阈值
}

// 交易手续费（单边）
// 0.04% = 0.0004，真实世界里算便宜的
const feeRate = 0.0004;

/**
 * 简单 BTC 趋势策略回测（带手续费版本）
 */
export function backtestSimpleBtcTrend(
  candles: Candle[],
  options: BacktestOptions = {}
): BacktestResult | null {
  const {
    useTrendFilter = true,
    stopLossPct = 0.02,
    takeProfitPct = 0.04,
    useV2Signal = false,
    minAtrPct = 0.01, // ✅ 默认改成 1% 波动，不要 1.5% 那么严
  } = options;

  if (candles.length < 200) {
    console.log("K线太少，至少需要200根以上。");
    return null;
  }

  const closes = candles.map((c) => c.close);
  const ema50 = ema(closes, 50);
  const ema200 = ema(closes, 200);
  const atr14 = atr(candles, 14); // 新增 ATR

  let inPosition = false;
  let entryPrice = 0;
  let entryTime = 0;

  const trades: Trade[] = [];

  // 从第200根开始（保证EMA暖机）
  for (let i = 200; i < candles.length; i++) {
    const price = closes[i]!;
    const prevPrice = closes[i - 1]!;
    const e50 = ema50[i]!;
    const prevE50 = ema50[i - 1]!;
    const e200 = ema200[i]!;
    const currentCandle = candles[i]!;
    const { high, low } = currentCandle;
    

    // === 行情过滤（多头结构 + 斜率 + 波动） ===
    const atrValue = atr14[i];
    if (atrValue === undefined) {
      // ATR 数据不足，跳过本轮
      continue;
    }
    const atrPct = atrValue / price; // ATR 占价格比例，粗略波动率

    const ema200Prev = ema200[i - 1];
    if (ema200Prev === undefined) {
      // EMA200 数据不足，跳过本轮
      continue;
    }
    const ema200Slope = e200 - ema200Prev; // 200EMA 斜率

    // 条件1：多头结构
    const isUpTrend = price > e200 && e50 > e200;
    // 条件2：200EMA 要往上走，不是横着/往下
    const strongSlope = ema200Slope > 0;
    const enoughVol = atrPct > minAtrPct;
    const trendOk = useTrendFilter
      ? isUpTrend && strongSlope && enoughVol
      : true;

    if (!inPosition) {
      let signal: "LONG" | "CLOSE_LONG" | "HOLD";

      if (useV2Signal) {
        // v2: 回踩确认再突破
        signal = detectSignalV2(candles, i, ema50, ema200, inPosition);
      } else {
        // v1: 简单突破
        signal = detectSignal(price, prevPrice, e50, prevE50, inPosition);
      }

      if (signal === "LONG" && trendOk) {
        inPosition = true;
        entryPrice = price;
        entryTime = currentCandle.closeTime;
      }
    } else {
      // 持仓状态 — 只看 SL/TP，不看 EMA
      const stopPrice = entryPrice * (1 - stopLossPct);
      const tpPrice = entryPrice * (1 + takeProfitPct);

      let shouldExit = false;
      let exitPrice = price;
      let exitReason: "SL" | "TP" | "EMA" = "EMA";

      // 止损优先
      if (low <= stopPrice) {
        shouldExit = true;
        exitPrice = stopPrice;
        exitReason = "SL";
      }
      // 止盈
      else if (high >= tpPrice) {
        shouldExit = true;
        exitPrice = tpPrice;
        exitReason = "TP";
      }

      if (shouldExit) {
        const exitTime = currentCandle.closeTime;

        // 毛收益（不含手续费）
        const grossPnlPct = ((exitPrice - entryPrice) / entryPrice) * 100;

        // 手续费（双边）
        const feePct = feeRate * 2 * 100;

        // 最终收益
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

  // 最后一笔强制平仓
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
 * 打印结果
 */
export function printBacktestResult(
  result: BacktestResult,
  candleCount: number
): void {
  console.log("=== 简单BTC趋势策略回测（含手续费） ===");
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
    EMA: emaCount,
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
