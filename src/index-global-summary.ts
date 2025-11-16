import { fetchBtc4hCandles } from "./exchange/binance.js";
import { backtestSimpleBtcTrend } from "./backtest/engine.js";
import type { BacktestResult } from "./backtest/engine.js";

// 复利权益 & 最大回撤 & 连亏统计
function computeEquityStats(trades: BacktestResult["trades"]) {
  // 没有交易的情况
  if (!trades.length) {
    return {
      totalReturnPct: 0,
      equityCurve: [1],
      maxDrawdownPct: 0,
      maxConsecutiveLosses: 0,
      annualizedReturnPct: 0,
    };
  }

  let equity = 1; // 从 1 起步
  const curve: number[] = [equity];

  let peak = equity;
  let maxDrawdownPct = 0;

  let maxConsecutiveLosses = 0;
  let currentLoseStreak = 0;

  for (const t of trades) {
    const r = t.pnlPct / 100;
    equity *= 1 + r;
    curve.push(equity);

    if (equity > peak) {
      peak = equity;
    }
    const dd = ((peak - equity) / peak) * 100;
    if (dd > maxDrawdownPct) {
      maxDrawdownPct = dd;
    }

    if (t.pnlPct < 0) {
      currentLoseStreak++;
      if (currentLoseStreak > maxConsecutiveLosses) {
        maxConsecutiveLosses = currentLoseStreak;
      }
    } else {
      currentLoseStreak = 0;
    }
  }

  const totalReturnPct = (equity - 1) * 100;

  // 粗略算年化：用第一笔 entry 和最后一笔 exit 的时间跨度
  let annualizedReturnPct = 0;
  const firstEntry = trades[0]!.entryTime;
  const lastExit = trades[trades.length - 1]!.exitTime;
  const days = (lastExit - firstEntry) / (1000 * 60 * 60 * 24);

  if (days > 0) {
    const years = days / 365;
    const annualized = Math.pow(equity, 1 / years) - 1;
    annualizedReturnPct = annualized * 100;
  }

  return {
    totalReturnPct,
    equityCurve: curve,
    maxDrawdownPct,
    maxConsecutiveLosses,
    annualizedReturnPct,
  };
}

async function main() {
  try {
    console.log("正在从Binance获取BTCUSDT 4小时K线...");
    const candles = await fetchBtc4hCandles(3000);
    console.log(`获取到 ${candles.length} 根K线。`);

    // 固定一套参数（global 一套，不再每个窗口单独调参）
    const fixedParams = {
      useTrendFilter: true,
      useV2Signal: false,   // v1 signal
      stopLossPct: 0.015,   // 1.5%
      takeProfitPct: 0.04,  // 4%
      minAtrPct: 0.005,     // 0.5%
    };

    // === 1. 整段 3000 根 K 的表现 ===
    const fullResult = backtestSimpleBtcTrend(candles, fixedParams);

    if (!fullResult) {
      console.log("全局回测失败。");
      return;
    }

    const fullStats = computeEquityStats(fullResult.trades);

    console.log("\n==============================");
    console.log("全局（3000 根 K）固定参数表现");
    console.log("==============================");
    console.log("交易笔数:", fullResult.totalTrades);
    console.log("总收益（复利）:", fullStats.totalReturnPct.toFixed(2), "%");
    console.log("胜率:", fullResult.winRate.toFixed(2), "%");
    console.log("最大回撤:", fullStats.maxDrawdownPct.toFixed(2), "%");
    console.log(
      "最大连续亏损笔数:",
      fullStats.maxConsecutiveLosses
    );
    console.log(
      "年化收益（粗略）:",
      fullStats.annualizedReturnPct.toFixed(2),
      "%"
    );

    console.log("前几笔交易示例:");
    console.log(
      fullResult.trades.slice(0, 5).map((t) => ({
        entry: new Date(t.entryTime).toISOString(),
        exit: new Date(t.exitTime).toISOString(),
        entryPrice: t.entryPrice,
        exitPrice: t.exitPrice,
        pnlPct: t.pnlPct.toFixed(2) + "%",
        exitReason: t.exitReason,
      }))
    );

    // === 2. 按窗口拆成 3 段，每段 1000 根，用同一套参数评估 ===
    const windowSize = 1000;
    const windowCount = Math.floor(candles.length / windowSize);

    console.log("\n==============================");
    console.log("按窗口评估（同一套参数）");
    console.log("==============================");

    for (let w = 0; w < windowCount; w++) {
      const start = w * windowSize;
      const end = start + windowSize;
      const windowCandles = candles.slice(start, end);

      const result = backtestSimpleBtcTrend(windowCandles, fixedParams);
      if (!result) {
        console.log(`\n窗口 ${w} [${start} ~ ${end}) 回测失败。`);
        continue;
      }

      const stats = computeEquityStats(result.trades);

      console.log("\n------------------------------");
      console.log(`窗口 ${w} [${start} ~ ${end})  共 ${windowCandles.length} 根K`);
      console.log("------------------------------");
      console.log("交易笔数:", result.totalTrades);
      console.log("总收益（复利）:", stats.totalReturnPct.toFixed(2), "%");
      console.log("胜率:", result.winRate.toFixed(2), "%");
      console.log("最大回撤:", stats.maxDrawdownPct.toFixed(2), "%");
      console.log(
        "最大连续亏损笔数:",
        stats.maxConsecutiveLosses
      );
      console.log(
        "年化收益（粗略）:",
        stats.annualizedReturnPct.toFixed(2),
        "%"
      );
    }
  } catch (err) {
    console.error("运行出错:", err);
  }
}

main();