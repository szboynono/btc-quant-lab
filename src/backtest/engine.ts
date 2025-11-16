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
  totalReturnPct: number;        // 仍然是简单相加的百分比（和你之前兼容）
  avgReturnPct: number;
  winRate: number;
  trades: Trade[];
  equityCurve: { time: number; equity: number }[]; // 权益曲线（以 1 为初始）
  maxDrawdownPct: number;        // 最大回撤（%）
  annualizedReturnPct: number;   // 粗略年化收益率（%）
}

/**
 * 回测参数配置
 */
export interface BacktestOptions {
  useTrendFilter?: boolean;   // 是否使用 200EMA 多头过滤 + 强度过滤
  stopLossPct?: number;       // 止损百分比（比如 0.02 = 2%）
  takeProfitPct?: number;     // 止盈百分比
  useV2Signal?: boolean;      // 是否使用 V2 信号
  minAtrPct?: number;         // 最小 ATR 波动率阈值（ATR / price）
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
    minAtrPct = 0.005, // 默认：ATR 至少 0.5% 波动
  } = options;

  if (candles.length < 200) {
    console.log("K线太少，至少需要200根以上。");
    return null;
  }

  const closes = candles.map((c) => c.close);
  const ema50 = ema(closes, 50);
  const ema200 = ema(closes, 200);
  const atr14 = atr(candles, 14); // ATR 用于波动率过滤

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
      continue; // 跳过没有 ATR 的数据
    }
    const atrPct = atrValue / price;             // ATR 占价格比例，粗略波动率
    const ema200Prev = ema200[i - 1]!;
    const ema200Slope = e200 - ema200Prev;       // 200EMA 斜率

    // 条件1：多头结构
    const isUpTrend = price > e200 && e50 > e200;
    // 条件2：200EMA 要往上走，不是横着/往下
    const strongSlope = ema200Slope > 0;
    // 条件3：波动率不能太低
    const enoughVol = atrPct > minAtrPct;

    // 最终趋势过滤：只在“多头 + 斜率向上 + 波动不低”时才允许开多
    const trendOk = useTrendFilter ? (isUpTrend && strongSlope && enoughVol) : true;

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
  const totalReturnPctSimple = trades.reduce((sum, t) => sum + t.pnlPct, 0);
  const avgReturnPct = totalTrades > 0 ? totalReturnPctSimple / totalTrades : 0;
  const wins = trades.filter((t) => t.pnlPct > 0);
  const winRate = totalTrades > 0 ? (wins.length / totalTrades) * 100 : 0;

  // ====== 权益曲线 & 最大回撤 & 年化收益 ======
  const equityCurve: { time: number; equity: number }[] = [];
  let equity = 1;         // 初始资金 = 1
  let peakEquity = 1;
  let maxDrawdownPct = 0;

  for (const t of trades) {
    equity *= 1 + t.pnlPct / 100; // 复利滚动
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
    const firstTrade = trades[0];
    const lastTrade = trades[trades.length - 1];
    if (!firstTrade || !lastTrade) {
      return {
        totalTrades,
        totalReturnPct: totalReturnPctSimple,
        avgReturnPct,
        winRate,
        trades,
        equityCurve,
        maxDrawdownPct,
        annualizedReturnPct,
      };
    }
    const firstTime = firstTrade.entryTime;
    const lastTime = lastTrade.exitTime;
    const msDiff = lastTime - firstTime;
    if (msDiff > 0) {
      const years = msDiff / (1000 * 60 * 60 * 24 * 365);
      const finalEquity = equity;
      annualizedReturnPct = (Math.pow(finalEquity, 1 / years) - 1) * 100;
    }
  }

  return {
    totalTrades,
    totalReturnPct: totalReturnPctSimple, // 保持和以前一样的定义
    avgReturnPct,
    winRate,
    trades,
    equityCurve,
    maxDrawdownPct,
    annualizedReturnPct,
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
