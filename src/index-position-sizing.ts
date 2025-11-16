import { fetchBtc4hCandles } from "./exchange/binance.js";
import {
  backtestSimpleBtcTrend,
  type BacktestResult,
} from "./backtest/engine.js";

/**
 * 按“每笔风险占总资金的固定百分比”来跑资金曲线
 * - initialCapital: 初始资金（比如 1000U）
 * - riskPerTradePct: 每笔风险占当前权益的百分比（比如 0.01 = 1%）
 * - stopLossPct: 策略配置的止损百分比（比如 0.015 = 1.5%）
 *
 * 思路：
 *  - 每笔开仓的时候，假设一旦打到止损，你亏 = equity * riskPerTradePct
 *  - 所以 仓位名义价值 = equity * riskPerTradePct / stopLossPct
 *  - 实际盈亏 = 仓位 * (pnlPct / 100)
 *  - 换算到权益 = equity * (riskPerTradePct / stopLossPct) * (pnlPct / 100)
 */
function computeEquityWithPositionSizing(
  result: BacktestResult,
  options: {
    initialCapital: number;
    riskPerTradePct: number; // 例如 0.01 = 1%
    stopLossPct: number;     // 例如 0.015 = 1.5%
  }
) {
  const { trades } = result;
  const { initialCapital, riskPerTradePct, stopLossPct } = options;

  if (!trades.length || stopLossPct <= 0) {
    return {
      totalReturnPct: 0,
      equityCurve: [initialCapital],
      maxDrawdownPct: 0,
      maxConsecutiveLosses: 0,
      annualizedReturnPct: 0,
      finalEquity: initialCapital,
    };
  }

  let equity = initialCapital;
  const curve: number[] = [equity];

  let peak = equity;
  let maxDrawdownPct = 0;

  let maxConsecutiveLosses = 0;
  let currentLoseStreak = 0;

  for (const t of trades) {
    const r = t.pnlPct / 100; // 例如 +3.92% -> 0.0392

    // 每笔根据“止损距离”和“允许亏损比例”来决定仓位大小
    const equityChangeFactor = 1 + (riskPerTradePct / stopLossPct) * r;
    equity *= equityChangeFactor;
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

  const totalReturnPct = ((equity / initialCapital) - 1) * 100;

  // 年化：用第一笔 entry 和最后一笔 exit 的时间跨度
  let annualizedReturnPct = 0;
  const firstEntry = trades[0]!.entryTime;
  const lastExit = trades[trades.length - 1]!.exitTime;
  const days = (lastExit - firstEntry) / (1000 * 60 * 60 * 24);

  if (days > 0) {
    const years = days / 365;
    const annualized = Math.pow(equity / initialCapital, 1 / years) - 1;
    annualizedReturnPct = annualized * 100;
  }

  return {
    totalReturnPct,
    equityCurve: curve,
    maxDrawdownPct,
    maxConsecutiveLosses,
    annualizedReturnPct,
    finalEquity: equity,
  };
}

async function main() {
  try {
    console.log("正在从Binance获取BTCUSDT 4小时K线...");
    const candles = await fetchBtc4hCandles(3000);
    console.log(`获取到 ${candles.length} 根K线。`);

    // 固定一套参数（跟你刚才 global summary 一致）
    const fixedParams = {
      useTrendFilter: true,
      useV2Signal: false,   // v1 signal
      stopLossPct: 0.015,   // 1.5%
      takeProfitPct: 0.04,  // 4%
      minAtrPct: 0.005,     // 0.5%
    };

    const initialCapital = 1000;   // 假设你拿 1000U 出来玩
    const riskPerTradePct = 0.01;  // 每笔最多亏 1%

    // === 1. 全局 3000 根 K，带仓位管理 ===
    const fullResult = backtestSimpleBtcTrend(candles, fixedParams);
    if (!fullResult) {
      console.log("全局回测失败。");
      return;
    }

    const fullStats = computeEquityWithPositionSizing(fullResult, {
      initialCapital,
      riskPerTradePct,
      stopLossPct: fixedParams.stopLossPct,
    });

    console.log("\n==============================");
    console.log("全局（3000 根 K）带仓位管理表现");
    console.log("==============================");
    console.log("初始资金:", initialCapital, "USDT");
    console.log("每笔风险:", (riskPerTradePct * 100).toFixed(2), "%");
    console.log("交易笔数:", fullResult.totalTrades);
    console.log(
      "最终资金:",
      fullStats.finalEquity.toFixed(2),
      "USDT"
    );
    console.log(
      "总收益（复利，资金维度）:",
      fullStats.totalReturnPct.toFixed(2),
      "%"
    );
    console.log("胜率（按笔数）:", fullResult.winRate.toFixed(2), "%");
    console.log(
      "最大回撤（资金维度）:",
      fullStats.maxDrawdownPct.toFixed(2),
      "%"
    );
    console.log(
      "最大连续亏损笔数:",
      fullStats.maxConsecutiveLosses
    );
    console.log(
      "年化收益（粗略，资金维度）:",
      fullStats.annualizedReturnPct.toFixed(2),
      "%"
    );

    // === 2. 按窗口拆成 3 段，每段 1000 根，用同一套参数 + 同样仓位规则 ===
    const windowSize = 1000;
    const windowCount = Math.floor(candles.length / windowSize);

    console.log("\n==============================");
    console.log("按窗口评估（同一套参数 + 仓位管理）");
    console.log("==============================");

    for (let w = 0; w < windowCount; w++) {
      const start = w * windowSize;
      const end = start + windowSize;
      const windowCandles = candles.slice(start, end);

      const winResult = backtestSimpleBtcTrend(windowCandles, fixedParams);
      if (!winResult) {
        console.log(`\n窗口 ${w} [${start} ~ ${end}) 回测失败。`);
        continue;
      }

      const stats = computeEquityWithPositionSizing(winResult, {
        initialCapital,
        riskPerTradePct,
        stopLossPct: fixedParams.stopLossPct,
      });

      console.log("\n------------------------------");
      console.log(`窗口 ${w} [${start} ~ ${end})  共 ${windowCandles.length} 根K`);
      console.log("------------------------------");
      console.log("交易笔数:", winResult.totalTrades);
      console.log(
        "最终资金:",
        stats.finalEquity.toFixed(2),
        "USDT"
      );
      console.log(
        "总收益（复利，资金维度）:",
        stats.totalReturnPct.toFixed(2),
        "%"
      );
      console.log(
        "最大回撤（资金维度）:",
        stats.maxDrawdownPct.toFixed(2),
        "%"
      );
      console.log(
        "最大连续亏损笔数:",
        stats.maxConsecutiveLosses
      );
      console.log(
        "年化收益（粗略，资金维度）:",
        stats.annualizedReturnPct.toFixed(2),
        "%"
      );
    }
  } catch (err) {
    console.error("运行出错:", err);
  }
}

main();