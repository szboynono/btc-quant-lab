import type { Candle, Trade } from "../types/candle.js";
import { ema } from "../indicators/ema.js";
import { detectSignal } from "../strategy/simple-trend.js";

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
  useTrendFilter?: boolean;  // 是否使用 200EMA 多头过滤
  stopLossPct?: number;      // 止损百分比，例如 0.02 = 2%
  takeProfitPct?: number;    // 止盈百分比，例如 0.04 = 4%
}

/**
 * 简单 BTC 趋势策略回测（带可选多头过滤 + 固定止损/止盈）
 *
 * - 用 4 小时收盘价
 * - 50EMA 定义信号（交给 detectSignal）
 * - 200EMA + 50EMA 可以定义「多头趋势」作为过滤
 * - 进场后：
 *   1. low <= 止损价 -> 用止损价平仓
 *   2. high >= 止盈价 -> 用止盈价平仓
 *   3. 信号给出 CLOSE_LONG -> 用收盘价平仓
 */
export function backtestSimpleBtcTrend(
  candles: Candle[],
  options: BacktestOptions = {}
): BacktestResult | null {
  const {
    useTrendFilter = true,
    stopLossPct = 0.02,   // 默认 2% 止损
    takeProfitPct = 0.04, // 默认 4% 止盈
  } = options;

  if (candles.length < 200) {
    console.log("K线太少，至少需要200根以上。");
    return null;
  }

  const closes = candles.map((c) => c.close);
  const ema50 = ema(closes, 50);
  const ema200 = ema(closes, 200);

  let inPosition = false;
  let entryPrice = 0;
  let entryTime = 0;

  const trades: Trade[] = [];

  // 从 200 开始，保证 EMA200 已经“暖机”
  for (let i = 200; i < candles.length; i++) {
    const price = closes[i]!;
    const prevPrice = closes[i - 1]!;
    const e50 = ema50[i]!;
    const prevE50 = ema50[i - 1]!;
    const e200 = ema200[i]!;
    const currentCandle = candles[i]!;
    const { high, low } = currentCandle;

    // 多头趋势过滤（可开关）：价格和 50EMA 都在 200EMA 上方
    const isUpTrend = price > e200 && e50 > e200;
    const trendOk = useTrendFilter ? isUpTrend : true;

    // 原有信号：只基于 50EMA 穿越 + 是否持仓
    const signal = detectSignal(price, prevPrice, e50, prevE50, inPosition);

    if (!inPosition) {
      // 开仓：必须有 LONG 信号，且趋势通过过滤
      if (signal === "LONG" && trendOk) {
        inPosition = true;
        entryPrice = price;
        entryTime = currentCandle.closeTime;
      }
    } else {
      // 已持有多单：检查止损 / 止盈 / EMA 平仓

      // 固定止损 / 止盈价
      const stopPrice = entryPrice * (1 - stopLossPct);
      const tpPrice = entryPrice * (1 + takeProfitPct);

      let shouldExit = false;
      let exitPrice = price; // 默认用当前收盘价，如果触发 SL/TP 会被覆盖

      // 1) 止损优先：本根最低价打到或跌破止损
      if (low <= stopPrice) {
        shouldExit = true;
        exitPrice = stopPrice;
      }
      // 2) 止盈：本根最高价打到或超过止盈（前提是没先触发止损）
      else if (high >= tpPrice) {
        shouldExit = true;
        exitPrice = tpPrice;
      }
      // 3) EMA 跌破信号：用收盘价平仓
      else if (signal === "CLOSE_LONG") {
        shouldExit = true;
        exitPrice = price;
      }

      if (shouldExit) {
        const exitTime = currentCandle.closeTime;
        const pnlPct = ((exitPrice - entryPrice) / entryPrice) * 100;

        trades.push({
          entryTime,
          exitTime,
          entryPrice,
          exitPrice,
          pnlPct,
        });

        inPosition = false;
      }
    }
  }

  // Close final position if still open
  if (inPosition) {
    const last = candles[candles.length - 1]!;
    const exitPrice = last.close;
    const exitTime = last.closeTime;
    const pnlPct = ((exitPrice - entryPrice) / entryPrice) * 100;

    trades.push({
      entryTime,
      exitTime,
      entryPrice,
      exitPrice,
      pnlPct,
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
 * 打印回测结果
 */
export function printBacktestResult(
  result: BacktestResult,
  candleCount: number
): void {
  console.log("=== 简单BTC趋势策略回测结果（趋势过滤 + 止损/止盈） ===");
  console.log("K线数量:", candleCount);
  console.log("交易笔数:", result.totalTrades);
  console.log(
    "总收益（简单相加，未复利）:",
    result.totalReturnPct.toFixed(2),
    "%"
  );
  console.log("平均每笔收益:", result.avgReturnPct.toFixed(2), "%");
  console.log("胜率:", result.winRate.toFixed(2), "%");
  console.log("前几笔交易示例:");
  console.log(
    result.trades.slice(0, 5).map((t) => ({
      entry: new Date(t.entryTime).toISOString(),
      exit: new Date(t.exitTime).toISOString(),
      entryPrice: t.entryPrice,
      exitPrice: t.exitPrice,
      pnlPct: t.pnlPct.toFixed(2) + "%",
    }))
  );
}