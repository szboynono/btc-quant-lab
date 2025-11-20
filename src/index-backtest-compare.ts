// src/index-backtest-compare.ts
import "dotenv/config";
import {
  fetchBtc4hCandles as fetchBtc4hHtx,
  fetchBtc1dCandles as fetchBtc1dHtx,
} from "./exchange/htx.js";

import {
  fetchBtc4hCandles as fetchBtc4hBinance,
  fetchBtc1dCandles as fetchBtc1dBinance,
} from "./exchange/binance.js";

import { runBacktestWithConfig } from "./backtest-regime.js";
import { printBacktestResult } from "./backtest/engine.js";

// 用你现在的 strategy.json 做基础参数
import strategy from "./config/strategy.json" with { type: "json" };

function buildBaseCfg() {
  return {
    useTrendFilter: strategy.useTrendFilter ?? true,
    stopLossPct: strategy.stopLossPct ?? 0.008,
    takeProfitPct: strategy.takeProfitPct ?? 0.05,
    minAtrPct: strategy.minAtrPct ?? 0.0075,
    maxRsiForEntry: 70,
    minRsiForEntry: 30,
  } as const;
}

async function runForSource(
  label: string,
  fetch4h: (limit: number) => Promise<any[]>,
  fetch1d: (limit: number) => Promise<any[]>,
  fourHLimit: number,
  oneDLimit: number
) {
  console.log(`\n\n===== ${label} 数据集回测 =====`);
  console.log(`正在从 ${label} 拉 BTCUSDT 4H & 1D K 线用于回测...`);

  const [candles4h, candles1d] = await Promise.all([
    fetch4h(fourHLimit),
    fetch1d(oneDLimit),
  ]);

  console.log(`4H K 线数量: ${candles4h.length}`);
  console.log(`1D K 线数量: ${candles1d.length}`);

  const baseCfg = buildBaseCfg();

  // === 回测 1：V2 ===
  const cfgV2 = {
    ...baseCfg,
    useV2Signal: true,
    useV3Signal: false,
  };

  console.log("\n=== 回测 1：V2（当前实盘思路/回踩确认） ===");
  console.log(JSON.stringify(cfgV2, null, 2));

  const retV2 = runBacktestWithConfig(candles4h, candles1d, cfgV2);
  if (!retV2 || !retV2.result) {
    console.log("V2 回测失败，可能是K线长度不够。");
  } else {
    printBacktestResult(retV2.result, candles4h.length);
  }

  // === 回测 2：V3 宽松确认 ===
  const cfgV3 = {
    ...baseCfg,
    useV2Signal: false,
    useV3Signal: true,
  };

  console.log("\n\n=== 回测 2：V3 宽松确认（同参数，只换信号） ===");
  console.log(JSON.stringify(cfgV3, null, 2));

  const retV3 = runBacktestWithConfig(candles4h, candles1d, cfgV3);
  if (!retV3 || !retV3.result) {
    console.log("V3 回测失败，可能是K线长度不够。");
  } else {
    printBacktestResult(retV3.result, candles4h.length);
  }
}

async function main() {
  // 1) HTX：最近一年（2000 根 4H）
  await runForSource("HTX（最近一年）", fetchBtc4hHtx, fetchBtc1dHtx, 2000, 500);

  // 2) Binance：更长样本（3000 根 4H）
  await runForSource(
    "Binance（较长历史样本）",
    fetchBtc4hBinance,
    fetchBtc1dBinance,
    3000,
    500
  );
}

main().catch((err) => {
  console.error("回测运行出错:", err);
  process.exit(1);
});