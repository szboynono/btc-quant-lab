// src/save-candles-htx.ts
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fetchBtc4hCandles, fetchBtc1dCandles } from "./exchange/htx.js";
import type { Candle } from "./types/candle.js";

async function main() {
  console.log("从 HTX 拉 BTCUSDT 历史 K 线并保存为本地样本...");

  // 想要多长样本，可以自己调这里的数量
  const [candles4h, candles1d] = await Promise.all([
    fetchBtc4hCandles(3000), // 大约 1.3 年 4H
    fetchBtc1dCandles(500),  // 大约 1.3 年 1D
  ]);

  console.log(`4H K 线数量: ${candles4h.length}`);
  console.log(`1D K 线数量: ${candles1d.length}`);

  const dataDir = path.resolve("./data");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const f4h = path.join(dataDir, "btc-4h.json");
  const f1d = path.join(dataDir, "btc-1d.json");

  fs.writeFileSync(f4h, JSON.stringify(candles4h, null, 2), "utf8");
  fs.writeFileSync(f1d, JSON.stringify(candles1d, null, 2), "utf8");

  console.log("✅ 已写入:");
  console.log("  - ./data/btc-4h.json");
  console.log("  - ./data/btc-1d.json");
}

main().catch((err) => {
  console.error("保存 K 线出错:", err);
  process.exit(1);
});