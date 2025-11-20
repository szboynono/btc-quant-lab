// src/index-backtest-static.ts
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";

import type { Candle } from "./types/candle.js";
import { runBacktestWithConfig } from "./backtest-regime.js";
import { printBacktestResult } from "./backtest/engine.js";

function loadCandles(relPath: string): Candle[] {
  const full = path.resolve(relPath);
  const raw = fs.readFileSync(full, "utf8");
  const data = JSON.parse(raw);
  return data as Candle[];
}

async function main() {
  console.log("从本地 ./data 读取 BTCUSDT 4H & 1D K 线用于【静态回测】...");

  const candles4h = loadCandles("./data/btc-4h.json");
  const candles1d = loadCandles("./data/btc-1d.json");

  console.log(`4H K 线数量: ${candles4h.length}`);
  console.log(`1D K 线数量: ${candles1d.length}`);

  if (candles4h.length < 200 || candles1d.length < 200) {
    console.log("K 线太少，至少需要 200 根。");
    return;
  }

  // === 回测 1：V2（你现在实盘在用的那套逻辑） ===
  const cfgV2 = {
    useTrendFilter: true,
    stopLossPct: 0.008,
    takeProfitPct: 0.05,
    minAtrPct: 0.0075,
    maxRsiForEntry: 70,
    minRsiForEntry: 30,
    useV2Signal: true,
    useV3Signal: false,
  } as const;

  console.log("\n=== 回测 1：V2（当前实盘思路，同参数） ===");
  console.log(JSON.stringify(cfgV2, null, 2));

  const retV2 = runBacktestWithConfig(candles4h, candles1d, cfgV2);

  if (!retV2 || !retV2.result) {
    console.log("V2 回测失败，可能是 K 线长度不够。");
  } else {
    printBacktestResult(retV2.result, candles4h.length);
  }

  // === 回测 2：V3（宽松确认，只换信号其他参数不变） ===
  const cfgV3 = {
    ...cfgV2,
    useV2Signal: false,
    useV3Signal: true,
  } as const;

  console.log("\n\n=== 回测 2：V3 宽松确认（同参数，只换信号） ===");
  console.log(JSON.stringify(cfgV3, null, 2));

  const retV3 = runBacktestWithConfig(candles4h, candles1d, cfgV3);

  if (!retV3 || !retV3.result) {
    console.log("V3 回测失败，可能是 K 线长度不够。");
    return;
  }

  printBacktestResult(retV3.result, candles4h.length);
}

main().catch((err) => {
  console.error("静态回测运行出错:", err);
  process.exit(1);
});