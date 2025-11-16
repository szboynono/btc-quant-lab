import { fetchBtc4hCandles } from "./exchange/binance.js";
import {
  backtestSimpleBtcTrend,
  printBacktestResult,
} from "./backtest/engine.js";

/**
 * 主流程：拉数据 -> 回测
 */
async function main() {
  try {
    console.log("正在从Binance获取BTCUSDT 4小时K线...");
    const candles = await fetchBtc4hCandles(1000);
    console.log(`获取到 ${candles.length} 根K线。开始参数扫描回测...`);

    // 简单参数网格：几种止损 / 止盈组合
    const slList = [0.015, 0.02];          // 1.5%、2%
    const tpList = [0.03, 0.04, 0.05];     // 3%、4%、5%

    for (const sl of slList) {
      for (const tp of tpList) {
        const result = backtestSimpleBtcTrend(candles, {
          useTrendFilter: true,      // 保持现在的多头过滤
          stopLossPct: sl,
          takeProfitPct: tp,
        });

        if (!result) continue;

        console.log(
          `SL=${(sl * 100).toFixed(1)}%, TP=${(tp * 100).toFixed(
            1
          )}% -> 总收益 ${result.totalReturnPct.toFixed(
            2
          )}%, 胜率 ${result.winRate.toFixed(2)}%, 笔数 ${
            result.totalTrades
          }`
        );
      }
    }

    // 如果你还想看某一组的详细结果，可以再跑一次单独打印：
    const baselineResult = backtestSimpleBtcTrend(candles, {
      useTrendFilter: true,
      stopLossPct: 0.02,
      takeProfitPct: 0.04,
    });

    if (baselineResult) {
      console.log("\n=== 基准参数（SL=2%, TP=4%）详细结果 ===");
      printBacktestResult(baselineResult, candles.length);
    }
  } catch (err) {
    console.error("运行出错:", err);
  }
}

main()