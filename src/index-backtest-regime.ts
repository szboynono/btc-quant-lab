// src/index-backtest-regime.ts
import "dotenv/config";
import { fetchBtc4hCandles, fetchBtc1dCandles } from "./exchange/binance.js";
import { printBacktestResult } from "./backtest/engine.js";
import { runBacktestWithConfig } from "./backtest-regime.js";
import strategy from "./config/strategy.json" with { type: "json" };

type StrategyConfig = typeof strategy;

async function main() {
  console.log("正在从 Binance 获取BTCUSDT 4小时K线...");
  const candles4h = await fetchBtc4hCandles(3000);
  console.log(`4H K 线数量: ${candles4h.length}`);

  console.log("正在从 Binance 获取BTCUSDT 1天K线...");
  const candles1d = await fetchBtc1dCandles(500);
  console.log(`1D K 线数量: ${candles1d.length}`);

  const cfg: StrategyConfig = strategy;

  const wrapped = runBacktestWithConfig(candles4h, candles1d, cfg);

  if (!wrapped || !wrapped.result) {
    console.log("回测无结果（可能K线不足或参数异常）。");
    return;
  }

  const { result, dailyTimes, dailyRegimes } = wrapped;

  console.log("\n=== 日线 Regime 统计（最近几天） ===");
  const last = dailyRegimes.slice(-5).map((r, idx) => ({
    date: new Date(
      dailyTimes[dailyTimes.length - 5 + idx]!
    ).toISOString(),
    regime: r,
  }));
  console.log(last);

  console.log("\n=== 强趋势策略（JSON 配置 + 日线 Regime 过滤） ===");
  console.log(cfg);

  console.log("");
  printBacktestResult(result, candles4h.length);
}

main().catch((err) => {
  console.error("运行出错:", err);
  process.exit(1);
});