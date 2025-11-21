// src/index-backtest-v3.ts
import "dotenv/config";
import { fetchBtc4hCandles, fetchBtc1dCandles } from "./exchange/htx.js";
import { runBacktestWithConfig } from "./backtest-regime.js";
import { printBacktestResult } from "./backtest/engine.js";
import strategy from "./config/strategy.json" with { type: "json" };

async function main() {
  console.log("正在从 HTX 拉 BTCUSDT 4H & 1D K 线用于回测...");

  const [candles4h, candles1d] = await Promise.all([
    fetchBtc4hCandles(3000),
    fetchBtc1dCandles(500),
  ]);

  console.log(`4H K 线数量: ${candles4h.length}`);
  console.log(`1D K 线数量: ${candles1d.length}`);

  if (candles4h.length < 200 || candles1d.length < 200) {
    console.log("K线长度不够，无法回测。");
    return;
  }

  // 从 strategy.json 抽出这次回测要用的公共参数
  const baseCfg = {
    useTrendFilter: strategy.useTrendFilter ?? true,
    stopLossPct: strategy.stopLossPct ?? 0.008,
    takeProfitPct: strategy.takeProfitPct ?? 0.04,
    minAtrPct: strategy.minAtrPct ?? 0.007,
    // 这里改成从 strategy.json 里读 RSI 区间
    maxRsiForEntry: strategy.maxRsiForEntry ?? 75,
    minRsiForEntry: strategy.minRsiForEntry ?? 30,
    rsiPeriod: strategy.rsiPeriod ?? 14,
    maxPremiumOverEma50: strategy.maxPremiumOverEma50 ?? 0.05,
  };

  console.log("\n=== 回测 1：V2（同一套参数，只用 V2 信号） ===");
  const v2Config = {
    ...baseCfg,
    useV2Signal: true,
    useV3Signal: false,
  };
  console.log(JSON.stringify(v2Config, null, 2));

  const v2Ret = runBacktestWithConfig(candles4h, candles1d, v2Config);

  if (!v2Ret || !v2Ret.result) {
    console.log("V2 回测失败。");
  } else {
    printBacktestResult(v2Ret.result, candles4h.length);
  }

  console.log("\n\n=== 回测 2：V3 宽松确认（同一套参数，只用 V3 信号） ===");
  const v3Config = {
    ...baseCfg,
    useV2Signal: false,
    useV3Signal: true,
  };
  console.log(JSON.stringify(v3Config, null, 2));

  const v3Ret = runBacktestWithConfig(candles4h, candles1d, v3Config);

  if (!v3Ret || !v3Ret.result) {
    console.log("V3 回测失败。");
  } else {
    printBacktestResult(v3Ret.result, candles4h.length);
  }
}

main().catch((err) => {
  console.error("回测运行出错:", err);
  process.exit(1);
});