import type { Candle, Trade } from "../types/candle.js";
import { ema } from "../indicators/ema.js";
import { detectSignal } from "../strategy/simple-trend.js";
import { detectSignalV2 } from "../strategy/simple-trend-v2.js";
import { detectSignalV3 } from "../strategy/simple-trend-v3.js";
import { detectRegimeFromEma } from "../strategy/regime.js";
import { atr } from "../indicators/atr.js";
import { rsi } from "../indicators/rsi.js";

/**
 * Regime 类型
 */
export type RegimeType = "BULL" | "BEAR" | "RANGE";

/**
 * 高周期（日线）regime 序列：
 * times: 日线K的时间戳（一般用 closeTime）
 * regimes: 对应的 regime
 * 要求 times 按从小到大排序
 */
export interface HigherTFRegimeSeries {
  times: number[];
  regimes: RegimeType[];
}

/**
 * 回测统计结果
 */
export interface BacktestResult {
  totalTrades: number;
  totalReturnPct: number;        // 简单相加的百分比
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
  useTrendFilter?: boolean;   // 是否使用 4h 200EMA 多头过滤 + 强度过滤
  stopLossPct?: number;       // 止损百分比（比如 0.02 = 2%）
  takeProfitPct?: number;     // 止盈百分比
  useV2Signal?: boolean;      // 是否使用 V2 信号
  useV3Signal?: boolean;      // 是否使用 V3 信号
  minAtrPct?: number;         // 最小 ATR 波动率阈值（ATR / price）

  // RSI 过滤参数
  maxRsiForEntry?: number;    // 开多时 RSI 不得高于多少，默认 70
  minRsiForEntry?: number;    // 开多时 RSI 不得低于多少，默认 30（防止刀口接飞刀）
  rsiPeriod?: number;         // RSI 计算周期，默认 14

  // 不追高过滤：价格相对 EMA50 的最大溢价
  maxPremiumOverEma50?: number; // 默认 5% 以内

  // ✅ 新增：高周期（日线）Regime 过滤
  /**
   * 可选：高周期（日线）Regime 序列。
   * 不传的话，就只看 4h 自己的 regime（保持与你现在一模一样的行为）
   */
  higherTFRegime?: HigherTFRegimeSeries;

  /**
   * 可选：允许开仓的高周期 regime 列表。
   * 比如只在日线多头时做多：["BULL"]
   * 默认为 ["BULL"]。
   */
  allowedHigherTFRegimes?: RegimeType[];
}

// 交易手续费（单边）
const feeRate = 0.0004; // 0.04%

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
    useV3Signal = false,
    minAtrPct = 0.005,   // 默认：ATR 至少 0.5% 波动
    maxRsiForEntry = 70, // RSI 太高不追
    minRsiForEntry = 30, // RSI 太低不抄底
    rsiPeriod = 14,
    maxPremiumOverEma50 = 0.05,

    // ✅ 新增：高周期（日线）regime 过滤相关
    higherTFRegime,
    allowedHigherTFRegimes = ["BULL"],
  } = options;

  if (candles.length < 200) {
    console.log("K线太少，至少需要200根以上。");
    return null;
  }

  const closes = candles.map((c) => c.close);
  const ema50 = ema(closes, 50);
  const ema200 = ema(closes, 200);
  const atr14 = atr(candles, 14);
  const rsiSeries = rsi(closes, rsiPeriod); // 新增 RSI 指标

  // ✅ 为高周期 regime 做一个「指针」
  let htTimes: number[] = [];
  let htRegimes: RegimeType[] = [];
  let htIndex = 0;

  if (higherTFRegime && higherTFRegime.times.length > 0) {
    htTimes = higherTFRegime.times;
    htRegimes = higherTFRegime.regimes;
    // 保险起见，假设 times 已经是升序（一般日线数据本来就是）
  }

  let inPosition = false;
  let entryPrice = 0;
  let entryTime = 0;

  const trades: Trade[] = [];

  // 从第200根开始（保证EMA/RSI/ATR都暖机）
  for (let i = 200; i < candles.length; i++) {
    const price = closes[i]!;
    const prevPrice = closes[i - 1]!;
    const e50 = ema50[i]!;
    const prevE50 = ema50[i - 1]!;
    const e200 = ema200[i]!;
    const currentCandle = candles[i]!;
    const { high, low, closeTime } = currentCandle;

    const atrValue = atr14[i];
    const r = rsiSeries[i];

    // 没有 ATR 或 RSI 的点直接跳过
    if (atrValue === undefined || r === undefined || Number.isNaN(r)) {
      continue;
    }

    const atrPct = atrValue / price;
    const premiumOverEma50 = e50 > 0 ? (price - e50) / e50 : Infinity;
    const ema200Prev = ema200[i - 1]!;

    // === 4h 自身的 Regime 判断 ===
    const { regime } = detectRegimeFromEma(
      price,
      e50,
      e200,
      ema200Prev
    );

    const enoughVol = atrPct > minAtrPct;

    // === ✅ 高周期（日线）Regime 过滤 ===
    let higherRegimeOk = true;
    if (htTimes.length > 0) {
      // 用「指针」在日线 times 数组里前进：
      // 用「指针」在日线 times 数组里前进，注意 htTimes 和 htRegimes 都应存在
      while (
        htTimes &&
        htRegimes &&
        htIndex + 1 < htTimes.length &&
        htTimes[htIndex + 1] !== undefined &&
        htTimes[htIndex + 1]! <= closeTime
      ) {
        htIndex++;
      }

      const htRegime = htRegimes[htIndex];
      if (htRegime && allowedHigherTFRegimes.length > 0) {
        higherRegimeOk = allowedHigherTFRegimes.includes(htRegime);
      }
    }

    // 总体趋势过滤：
    // - 原来：必须 4h 是多头结构 + 波动率够
    // - 现在：在此基础上再叠加「高周期 regime 必须允许」
    const trendOk = useTrendFilter
      ? regime === "BULL" && enoughVol && higherRegimeOk
      : higherRegimeOk;

    // 不满足 Regime / 波动率 / 高周期过滤，直接跳过，不开仓
    if (!trendOk) {
      continue;
    }

    // === RSI 过滤（避免追高 + 避免太超跌） ===
    const rsiOk = r <= maxRsiForEntry && r >= minRsiForEntry;
    const notTooHigh = premiumOverEma50 <= maxPremiumOverEma50;

    if (!inPosition) {
      let signal: "LONG" | "CLOSE_LONG" | "HOLD";

      if (useV3Signal) {
        signal = detectSignalV3(candles, i, ema50, ema200, inPosition);
      } else if (useV2Signal) {
        // v2: 回踩确认再突破
        signal = detectSignalV2(candles, i, ema50, ema200, inPosition);
      } else {
        // v1: 简单突破
        signal = detectSignal(price, prevPrice, e50, prevE50, inPosition);
      }

      // 只有在：趋势（4h）ok + 高周期 ok + 波动 ok + RSI ok + 不追高 ok 时才开多
      if (signal === "LONG" && trendOk && rsiOk && notTooHigh) {
        inPosition = true;
        entryPrice = price;
        entryTime = currentCandle.closeTime;
      }
    } else {
      // 持仓状态 — 只看 SL/TP，不看 EMA / RSI
      const stopPrice = entryPrice * (1 - stopLossPct);
      const tpPrice = entryPrice * (1 + takeProfitPct);

      let shouldExit = false;
      let exitPrice = price;
      let exitReason: "SL" | "TP" | "EMA" = "EMA";

      if (low <= stopPrice) {
        shouldExit = true;
        exitPrice = stopPrice;
        exitReason = "SL";
      } else if (high >= tpPrice) {
        shouldExit = true;
        exitPrice = tpPrice;
        exitReason = "TP";
      }

      if (shouldExit) {
        const exitTime = currentCandle.closeTime;

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
    const firstTrade = trades[0]!;
    const lastTrade = trades[trades.length - 1]!;
    const msDiff = lastTrade.exitTime - firstTrade.entryTime;
    if (msDiff > 0) {
      const years = msDiff / (1000 * 60 * 60 * 24 * 365);
      const finalEquity = equity;
      annualizedReturnPct = (Math.pow(finalEquity, 1 / years) - 1) * 100;
    }
  }

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