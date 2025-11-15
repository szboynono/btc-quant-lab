import { fetchBtc4hCandles } from "./exchange/binance.js";
import { backtestSimpleBtcTrend, printBacktestResult } from "./backtest/engine.js";

/**
 * 主流程：拉数据 -> 回测
 */
async function main() {
  try {
    console.log("正在从Binance获取BTCUSDT 4小时K线...");
    const candles = await fetchBtc4hCandles(500);
    console.log(`获取到 ${candles.length} 根K线。开始回测...`);
    
    const result = backtestSimpleBtcTrend(candles);
    if (result) {
      printBacktestResult(result, candles.length);
    }
  } catch (err) {
    console.error("运行出错:", err);
  }
}

main();