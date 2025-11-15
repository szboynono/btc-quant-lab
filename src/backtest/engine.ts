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
 * 一个非常简陋的策略回测：
 * - 用4小时收盘价
 * - 用50EMA定义"多头"
 * - 规则：
 *   1. 从下向上突破50EMA -> 开多
 *   2. 从上向下跌破50EMA -> 平多
 *   3. 同一时间只持有一笔多单
 */
export function backtestSimpleBtcTrend(candles: Candle[]): BacktestResult | null {
  if (candles.length < 60) {
    console.log("K线太少，至少需要几十根以上。");
    return null;
  }

  const closes = candles.map((c) => c.close);
  const ema50 = ema(closes, 50);

  let inPosition = false;
  let entryPrice = 0;
  let entryTime = 0;

  const trades: Trade[] = [];

  for (let i = 1; i < candles.length; i++) {
    // Safe: i is in bounds [1, candles.length), so i-1 >= 0 and i < length
    const price = closes[i]!;
    const prevPrice = closes[i - 1]!;
    const e50 = ema50[i]!;
    const prevE50 = ema50[i - 1]!;
    const currentCandle = candles[i]!;

    const signal = detectSignal(price, prevPrice, e50, prevE50, inPosition);

    if (signal === "LONG") {
      inPosition = true;
      entryPrice = price;
      entryTime = currentCandle.closeTime;
    } else if (signal === "CLOSE_LONG") {
      const exitPrice = price;
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

  // Close final position if still open
  if (inPosition) {
    // Safe: we check candles.length >= 60 at the start, so last element exists
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
export function printBacktestResult(result: BacktestResult, candleCount: number): void {
  console.log("=== 简单BTC趋势策略回测结果（MVP） ===");
  console.log("K线数量:", candleCount);
  console.log("交易笔数:", result.totalTrades);
  console.log("总收益（简单相加，未复利）:", result.totalReturnPct.toFixed(2), "%");
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
