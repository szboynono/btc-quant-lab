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
    console.log(`获取到 ${candles.length} 根K线。开始回测（v2 signal）...`);

    const result = backtestSimpleBtcTrend(candles, {
      useTrendFilter: true,
      useV2Signal: true,   // 👈 打开 v2
      stopLossPct: 0.02,
      takeProfitPct: 0.04,
    });

    if (result) {
      printBacktestResult(result, candles.length);
    }
  } catch (err) {
    console.error("运行出错:", err);
  }
}

main();