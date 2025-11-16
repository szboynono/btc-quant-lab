import type { Candle, Trade } from "../types/candle.js";
import type { BacktestResult } from "./engine.js";
import { ema } from "../indicators/ema.js";
import { atr } from "../indicators/atr.js";
import { rsi } from "../indicators/rsi.js";

// 交易手续费（单边）
const feeRate = 0.0004;

export interface WeakRsiOptions {
  // 震荡过滤：ATR / price 在这个区间内认为是“可以玩均值回归的波动”
  minAtrPct?: number;   // 默认 0.3%
  maxAtrPct?: number;   // 默认 1.0%

  // RSI 开仓/平仓阈值
  rsiBuy?: number;      // 默认 35 以下认为超跌
  rsiSell?: number;     // 默认 50 回到均值附近就走

  // 止损止盈
  stopLossPct?: number; // 默认 1% 止损
  takeProfitPct?: number; // 默认 2% 止盈

  // 趋势过滤相关
  useTrendFilter?: boolean; // 是否要求 price、EMA50 在 EMA200 上方
  maxEma200Slope?: number;  // EMA200 斜率绝对值小于此值视为“弱趋势/横盘”
}

/**
 * BTC 弱趋势 / 震荡 RSI 均值回归策略回测
 */
export function backtestWeakRsiMeanRevert(
  candles: Candle[],
  options: WeakRsiOptions = {}
): BacktestResult | null {
  const {
    minAtrPct = 0.003,   // 0.3%
    maxAtrPct = 0.01,    // 1.0%
    rsiBuy = 35,
    rsiSell = 50,
    stopLossPct = 0.01,
    takeProfitPct = 0.02,
    useTrendFilter = true,
    maxEma200Slope = 10, // 斜率“绝对值”允许的最大值，越小越严格
  } = options;

  if (candles.length < 200) {
    console.log("K线太少，至少需要200根以上（弱趋势RSI策略）。");
    return null;
  }

  const closes = candles.map((c) => c.close);
  const ema50 = ema(closes, 50);
  const ema200 = ema(closes, 200);
  const atr14 = atr(candles, 14);
  const rsi14 = rsi(closes, 14);

  let inPosition = false;
  let entryPrice = 0;
  let entryTime = 0;

  const trades: Trade[] = [];

  // === 主循环，从第 200 根开始（指标暖机）===
  for (let i = 200; i < candles.length; i++) {
    const c = candles[i]!;
    const price = closes[i]!;
    const e50 = ema50[i]!;
    const e200 = ema200[i]!;
    const r = rsi14[i];
    const a = atr14[i];

    if (r === undefined || a === undefined) continue;

    const atrPct = a / price; // 粗略波动率
    const ema200Prev = ema200[i - 1]!;
    const ema200Slope = e200 - ema200Prev;

    // === “弱趋势 / 震荡 + 上方结构”过滤 ===
    let regimeOk = true;

    if (useTrendFilter) {
      // 1. 大结构仍然在 EMA200 上方（不要抄刀底）
      const above200 = price > e200 && e50 > e200;

      // 2. EMA200 不要有很强的上/下趋势（绝对斜率过大就算强趋势）
      const slopeOk = Math.abs(ema200Slope) <= maxEma200Slope;

      // 3. 波动率在 [minAtrPct, maxAtrPct] 之间，太小没肉吃，太大容易接飞刀
      const volOk = atrPct >= minAtrPct && atrPct <= maxAtrPct;

      regimeOk = above200 && slopeOk && volOk;
    }

    const { high, low } = c;

    if (!inPosition) {
      // === 开仓逻辑：只在震荡 regime + RSI 超跌 + 价格在 EMA50 附近/下方 ===
      if (regimeOk && r <= rsiBuy && price <= e50) {
        inPosition = true;
        entryPrice = price;
        entryTime = c.closeTime;
      }
    } else {
      // === 持仓：优先 SL / TP，再看 RSI 反弹出场 ===
      const stopPrice = entryPrice * (1 - stopLossPct);
      const tpPrice = entryPrice * (1 + takeProfitPct);

      let shouldExit = false;
      let exitPrice = price;
      let exitReason: "SL" | "TP" | "EMA" | "MEAN" = "MEAN";

      // 1. 止损优先
      if (low <= stopPrice) {
        shouldExit = true;
        exitPrice = stopPrice;
        exitReason = "SL";
      }
      // 2. 止盈
      else if (high >= tpPrice) {
        shouldExit = true;
        exitPrice = tpPrice;
        exitReason = "TP";
      }
      // 3. RSI 回到/超过 rsiSell，当作“回归均值”，平仓
      else if (r >= rsiSell) {
        shouldExit = true;
        exitPrice = price;
        exitReason = "MEAN";
      }

      if (shouldExit) {
        const exitTime = c.closeTime;

        // 毛收益
        const grossPnlPct = ((exitPrice - entryPrice) / entryPrice) * 100;
        // 手续费（双边）
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

  // === 强制平最后一笔 ===
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

  // ====== 权益曲线 & 最大回撤 & 年化 ======
  const equityCurve: { time: number; equity: number }[] = [];
  let equity = 1;
  let peakEquity = 1;
  let maxDrawdownPct = 0;

  for (const t of trades) {
    equity *= 1 + t.pnlPct / 100;
    equityCurve.push({ time: t.exitTime, equity });

    if (equity > peakEquity) {
      peakEquity = equity;
    }
    const dd = ((peakEquity - equity) / peakEquity) * 100;
    if (dd > maxDrawdownPct) {
      maxDrawdownPct = dd;
    }
  }

  let annualizedReturnPct = 0;
  if (trades.length > 0 && equityCurve.length > 0) {
    const firstTime = trades[0]!.entryTime;
    const lastTime = trades[trades.length - 1]!.exitTime;
    const msDiff = lastTime - firstTime;
    if (msDiff > 0) {
      const years = msDiff / (1000 * 60 * 60 * 24 * 365);
      const finalEquity = equity;
      annualizedReturnPct = (Math.pow(finalEquity, 1 / years) - 1) * 100;
    }
  }

  return {
    totalTrades,
    totalReturnPct,
    avgReturnPct,
    winRate,
    trades,
    equityCurve,
    maxDrawdownPct,
    annualizedReturnPct,
  };
}

/**
 * 打印结果（沿用 engine 的格式习惯）
 */
export function printWeakRsiResult(
  result: BacktestResult,
  candleCount: number
): void {
  console.log("=== BTC 弱趋势 / 震荡 RSI 均值回归策略回测（含手续费） ===");
  console.log("K线数量:", candleCount);
  console.log("交易笔数:", result.totalTrades);
  console.log("总收益（简单相加）:", result.totalReturnPct.toFixed(2), "%");
  console.log("平均每笔收益:", result.avgReturnPct.toFixed(2), "%");
  console.log("胜率:", result.winRate.toFixed(2), "%");

  if (result.equityCurve.length > 0) {
    const finalEquity =
      result.equityCurve[result.equityCurve.length - 1]!.equity;
    console.log("最终权益倍数（以1起步）:", finalEquity.toFixed(3));
  }

  console.log("最大回撤:", result.maxDrawdownPct.toFixed(2), "%");
  console.log("年化收益（粗略）:", result.annualizedReturnPct.toFixed(2), "%");

  const slCount = result.trades.filter((t) => t.exitReason === "SL").length;
  const tpCount = result.trades.filter((t) => t.exitReason === "TP").length;
  const meanCount = result.trades.filter((t) => t.exitReason === "MEAN").length;
  const emaCount = result.trades.filter((t) => t.exitReason === "EMA").length;

  console.log("退出方式统计:", {
    SL: slCount,
    TP: tpCount,
    MEAN: meanCount,
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