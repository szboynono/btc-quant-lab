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

  // 把你 strategy.json 里和回测相关的字段抽出来
  const baseCfg = {
    useTrendFilter: strategy.useTrendFilter ?? true,
    stopLossPct: strategy.stopLossPct ?? 0.008,
    takeProfitPct: strategy.takeProfitPct ?? 0.05,
    minAtrPct: strategy.minAtrPct ?? 0.0075,
    // 先用固定的 RSI 区间，之后想优化再说
    maxRsiForEntry: 70,
    minRsiForEntry: 30,
  };

  console.log("\n=== 回测 1：V2（当前实盘思路，同参数） ===");
  console.log(
    JSON.stringify(
      {
        ...baseCfg,
        useV2Signal: true,
        useV3Signal: false,
      },
      null,
      2
    )
  );

  const v2Ret = runBacktestWithConfig(candles4h, candles1d, {
    ...baseCfg,
    useV2Signal: true,
    useV3Signal: false,
  });

  if (!v2Ret || !v2Ret.result) {
    console.log("V2 回测失败。");
  } else {
    printBacktestResult(v2Ret.result, candles4h.length);
  }

  console.log("\n\n=== 回测 2：V3 宽松确认（同参数，只换信号） ===");
  console.log(
    JSON.stringify(
      {
        ...baseCfg,
        useV2Signal: false,
        useV3Signal: true,
      },
      null,
      2
    )
  );

  const v3Ret = runBacktestWithConfig(candles4h, candles1d, {
    ...baseCfg,
    useV2Signal: false,
    useV3Signal: true,
  });

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