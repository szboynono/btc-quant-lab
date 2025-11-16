// src/run-every-4h.ts
import "dotenv/config";
import { fetchBtc4hCandles } from "./exchange/binance.js";
import type { Candle } from "./types/candle.js";
import { ema } from "./indicators/ema.js";
import { atr } from "./indicators/atr.js";
import { detectSignal } from "./strategy/simple-trend.js";
import { detectSignalV2 } from "./strategy/simple-trend-v2.js";
import { sendDiscordNotification } from "./notify/notify-discord.js";
import { appendSignalLog } from "./log/signal-log.js";

const CONFIG = {
  useV2Signal: false,
  stopLossPct: 0.015,
  takeProfitPct: 0.04,
  minAtrPct: 0.01, // ATR/price > 1%
};

async function runOnce() {
  console.log("正在从Binance获取BTCUSDT 4小时K线...");
  const candles = await fetchBtc4hCandles(3000);
  console.log(`获取到 ${candles.length} 根K线。`);

  if (candles.length < 200) {
    console.log("K 线太少，至少需要 200 根。");
    return;
  }

  const closes = candles.map((c) => c.close);
  const ema50 = ema(closes, 50);
  const ema200 = ema(closes, 200);
  const atr14 = atr(candles, 14);

  const i = candles.length - 1;
  const candle = candles[i] as Candle;
  const price = candle.close;
  const prevPrice = closes[i - 1]!;
  const e50 = ema50[i]!;
  const prevE50 = ema50[i - 1]!;
  const e200 = ema200[i]!;
  const ema200Prev = ema200[i - 1]!;
  const atrValue = atr14[i];

  console.log("\n=== 当前 4H K 线状态 ===");
  console.log("收盘时间:", new Date(candle.closeTime).toISOString());
  console.log("收盘价格:", price.toFixed(2));
  console.log("EMA50:", e50.toFixed(2));
  console.log("EMA200:", e200.toFixed(2));

  if (atrValue === undefined) {
    console.log("ATR 数据不足，跳过本次。");
    return;
  }

  const atrPct = atrValue / price;
  const ema200Slope = e200 - ema200Prev;

  console.log(
    `ATR(14): ${atrValue.toFixed(2)} (${(atrPct * 100).toFixed(2)}%)`
  );
  console.log("200EMA 斜率:", ema200Slope.toFixed(4));

  // === 趋势过滤 ===
  const isUpTrend = price > e200 && e50 > e200;
  const strongSlope = ema200Slope > 0;
  const enoughVol = atrPct > CONFIG.minAtrPct;

  console.log("\n=== 趋势过滤 ===");
  console.log("多头结构 (price > EMA200 && EMA50 > EMA200):", isUpTrend);
  console.log("200EMA 向上 (slope > 0):", strongSlope);
  console.log(
    "波动率足够 (ATR/price > minAtrPct):",
    enoughVol,
    ", minAtrPct=" + (CONFIG.minAtrPct * 100).toFixed(2) + "%"
  );

  const trendOk = isUpTrend && strongSlope && enoughVol;

  // 假设当前空仓
  const inPosition = false;
  let rawSignal: "LONG" | "CLOSE_LONG" | "HOLD";

  if (CONFIG.useV2Signal) {
    rawSignal = detectSignalV2(candles, i, ema50, ema200, inPosition);
  } else {
    rawSignal = detectSignal(price, prevPrice, e50, prevE50, inPosition);
  }

  console.log("\n=== 信号判断（假设当前空仓） ===");
  console.log("原始信号 rawSignal:", rawSignal);
  console.log("trendOk:", trendOk);

  // === 不管有没有信号，先算出“如果进场”的 SL/TP 和杠杆风险，用于日志 ===
  const entryPrice = price;
  const stopLoss = entryPrice * (1 - CONFIG.stopLossPct);
  const takeProfit = entryPrice * (1 + CONFIG.takeProfitPct);

  const slPct = -CONFIG.stopLossPct * 100;
  const tpPct = CONFIG.takeProfitPct * 100;

  const lev3 = {
    slPctOnEquity: slPct * 3,
    tpPctOnEquity: tpPct * 3,
  };
  const lev5 = {
    slPctOnEquity: slPct * 5,
    tpPctOnEquity: tpPct * 5,
  };

  // === 每次都写一条 log（包括观望的情况） ===
  await appendSignalLog({
    time: new Date(candle.closeTime).toISOString(),
    price: entryPrice,
    stopLoss,
    takeProfit,
    rawSignal,
    trendOk,
    ema50: e50,
    ema200: e200,
    atrPct: atrPct * 100,
    leverage3x: lev3,
    leverage5x: lev5,
  });

  // 如果没有有效多头信号：只写了 log，不发推送
  if (!(rawSignal === "LONG" && trendOk)) {
    console.log("\n>>> 建议：❌ 观望（要么没突破，要么趋势过滤不通过）");
    console.log("（本次状态已写入 signal-log.jsonl）");
    return;
  }

  // === 有有效的多头信号：再额外提示 + 推送 ===
  console.log("\n>>> 检测到 ✅ 多头入场信号！");
  console.log("入场价:", entryPrice.toFixed(2));
  console.log(
    `止损价: ${stopLoss.toFixed(2)} (${slPct.toFixed(2)}%)  ` +
      `→ 3x: ${lev3.slPctOnEquity.toFixed(
        2
      )}%, 5x: ${lev5.slPctOnEquity.toFixed(2)}%`
  );
  console.log(
    `止盈价: ${takeProfit.toFixed(2)} (${tpPct.toFixed(2)}%)  ` +
      `→ 3x: ${lev3.tpPctOnEquity.toFixed(
        2
      )}%, 5x: ${lev5.tpPctOnEquity.toFixed(2)}%`
  );

  const title = "BTC 4H 多头信号 (策略 v1)";
  const text = [
    `价格: ${entryPrice.toFixed(2)}`,
    `SL: ${stopLoss.toFixed(2)} (${slPct.toFixed(2)}%)`,
    `TP: ${takeProfit.toFixed(2)} (+${tpPct.toFixed(2)}%)`,
    `3x: SL ${lev3.slPctOnEquity.toFixed(1)}%, TP +${lev3.tpPctOnEquity.toFixed(
      1
    )}%`,
    `5x: SL ${lev5.slPctOnEquity.toFixed(1)}%, TP +${lev5.tpPctOnEquity.toFixed(
      1
    )}%`,
    `EMA50: ${e50.toFixed(2)}, EMA200: ${e200.toFixed(2)}`,
    `ATR: ${(atrPct * 100).toFixed(2)}%`,
  ].join("\n");

  await sendDiscordNotification({ title, text });

  console.log("\n>>> 已写入 signal-log.jsonl 并尝试发送 Discord 通知。");
}

runOnce().catch((err) => {
  console.error("运行出错:", err);
  process.exit(1);
});
