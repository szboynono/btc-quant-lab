// src/run-every-4h.ts
import "dotenv/config";
// import { fetchBtc4hCandles } from "./exchange/binance.js";
import { fetchBtc4hCandles, fetchBtc1dCandles } from "./exchange/htx.js";
import type { Candle } from "./types/candle.js";
import { ema } from "./indicators/ema.js";
import { atr } from "./indicators/atr.js";
import { detectSignal } from "./strategy/simple-trend.js";
import { detectSignalV2 } from "./strategy/simple-trend-v2.js";
import { detectRegimeFromEma, type Regime } from "./strategy/regime.js";
import { sendDiscordNotification } from "./notify/notify-discord.js";
import { appendSignalLog } from "./log/signal-log.js";

import strategy from "./config/strategy.json" with { type: "json" };
import position from "./config/position.json" with { type: "json" };

const CONFIG = strategy;
const POSITION = position;

async function runOnce() {
  console.log("正在从 HTX 获取BTCUSDT 4小时 & 日线 K 线...");

  const [candles4h, candles1d] = await Promise.all([
    fetchBtc4hCandles(3000),
    fetchBtc1dCandles(500),
  ]);

  console.log(`4H K 线数量: ${candles4h.length}`);
  console.log(`1D K 线数量: ${candles1d.length}`);

  if (candles4h.length < 200) {
    console.log("4H K 线太少，至少需要 200 根。");
    return;
  }
  if (candles1d.length < 210) {
    console.log("1D K 线太少，至少需要 210 根（日线 EMA200 需要足够长度）。");
    return;
  }

  // =============== 4H 部分 ===============
  const closes4h = candles4h.map((c) => c.close);
  const ema50_4h = ema(closes4h, 50);
  const ema200_4h = ema(closes4h, 200);
  const atr14_4h = atr(candles4h, 14);

  const i = candles4h.length - 1;
  const candle4h = candles4h[i] as Candle;
  const price4h = candle4h.close;
  const prevPrice4h = closes4h[i - 1]!;
  const e50_4h = ema50_4h[i]!;
  const prevE50_4h = ema50_4h[i - 1]!;
  const e200_4h = ema200_4h[i]!;
  const e200Prev_4h = ema200_4h[i - 1]!;
  const atrValue4h = atr14_4h[i];

  console.log("\n=== 当前 4H K 线状态 ===");
  console.log("收盘时间:", new Date(candle4h.closeTime).toISOString());
  console.log("收盘价格:", price4h.toFixed(2));
  console.log("EMA50:", e50_4h.toFixed(2));
  console.log("EMA200:", e200_4h.toFixed(2));

  if (atrValue4h === undefined) {
    console.log("ATR 数据不足，跳过本次。");
    return;
  }

  const atrPct4h = atrValue4h / price4h;
  const ema200Slope4h = e200_4h - e200Prev_4h;

  console.log(
    `ATR(14): ${atrValue4h.toFixed(2)} (${(atrPct4h * 100).toFixed(2)}%)`
  );
  console.log("200EMA 斜率:", ema200Slope4h.toFixed(4));

  // === 4H 趋势过滤 ===
  const isUpTrend4h = price4h > e200_4h && e50_4h > e200_4h;
  const strongSlope4h = ema200Slope4h > 0;
  const enoughVol4h = atrPct4h > CONFIG.minAtrPct;

  console.log("\n=== 4H 趋势过滤 ===");
  console.log("多头结构 (price > EMA200 && EMA50 > EMA200):", isUpTrend4h);
  console.log("200EMA 向上 (slope > 0):", strongSlope4h);
  console.log(
    "波动率足够 (ATR/price > minAtrPct):",
    enoughVol4h,
    ", minAtrPct=" + (CONFIG.minAtrPct * 100).toFixed(2) + "%"
  );

  const trendOk4h = CONFIG.useTrendFilter
    ? isUpTrend4h && strongSlope4h && enoughVol4h
    : true;

  // =============== 日线 Regime 部分 ===============
  const closes1d = candles1d.map((c) => c.close);
  const emaFast1d = ema(closes1d, 50);
  const emaSlow1d = ema(closes1d, 200);

  const j = candles1d.length - 1;
  const lastDay = candles1d[j]!;
  const price1d = lastDay.close;
  const eFast1d = emaFast1d[j];
  const eSlow1d = emaSlow1d[j];
  const prevESlow1d = emaSlow1d[j - 1];

  let dailyRegime: Regime | undefined = undefined;
  let slopeSlow1d = 0;
  let regimeOk = false;

  if (
    eFast1d === undefined ||
    eSlow1d === undefined ||
    prevESlow1d === undefined
  ) {
    console.log("\n=== 日线 Regime 过滤 ===");
    console.log("日线 EMA 数据不足，无法判断 Regime，默认视为不通过。");
  } else {
    const res = detectRegimeFromEma(price1d, eFast1d, eSlow1d, prevESlow1d);
    dailyRegime = res.regime;
    slopeSlow1d = res.slopeSlow;
    regimeOk = dailyRegime === "BULL";

    console.log("\n=== 日线 Regime 过滤 ===");
    console.log("最近日线收盘时间:", new Date(lastDay.closeTime).toISOString());
    console.log("日线收盘价:", price1d.toFixed(2));
    console.log("日线 EMA50:", eFast1d.toFixed(2));
    console.log("日线 EMA200:", eSlow1d.toFixed(2));
    console.log("日线 EMA200 斜率:", slopeSlow1d.toFixed(4));
    console.log("日线 Regime:", dailyRegime);
    console.log("Regime 过滤通过?(仅允许 BULL):", regimeOk);
  }

  // =============== 信号判断（假设当前空仓） ===============
  const inPosition = false;
  let rawSignal: "LONG" | "CLOSE_LONG" | "HOLD";

  if (CONFIG.useV2Signal) {
    rawSignal = detectSignalV2(candles4h, i, ema50_4h, ema200_4h, inPosition);
  } else {
    rawSignal = detectSignal(
      price4h,
      prevPrice4h,
      e50_4h,
      prevE50_4h,
      inPosition
    );
  }

  console.log("\n=== 信号判断（假设当前空仓） ===");
  console.log("原始信号 rawSignal:", rawSignal);
  console.log("4H trendOk:", trendOk4h);
  console.log("日线 regimeOk:", regimeOk);

  // === 预先计算 SL / TP ===
  const entryPrice = price4h;
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

  // === 仓位建议（从 position.json 里读） ===
  const accountSize = POSITION.accountSizeUSDT;
  const capitalPct = POSITION.capitalPctPerTrade;
  const leverage = POSITION.defaultLeverage;

  const capitalToUse = accountSize * capitalPct;
  const notional = capitalToUse * leverage;
  const qtyBTC = notional / entryPrice;

  // === 每次都写一条 log（包括观望的情况） ===
  const logEntry: Parameters<typeof appendSignalLog>[0] = {
    time: new Date(candle4h.closeTime).toISOString(),
    price: entryPrice,
    stopLoss,
    takeProfit,
    rawSignal,
    trendOk: trendOk4h,
    regimeOk,
    ema50: e50_4h,
    ema200: e200_4h,
    atrPct: atrPct4h * 100,
    leverage3x: lev3,
    leverage5x: lev5,
    positionSuggestion: {
      accountSizeUSDT: accountSize,
      capitalPctPerTrade: capitalPct,
      leverage,
      capitalToUse,
      notional,
      qtyBTC,
    },
  };

  // 只在有值时才添加 dailyRegime（符合 exactOptionalPropertyTypes）
  if (dailyRegime !== undefined) {
    logEntry.dailyRegime = dailyRegime;
  }

  await appendSignalLog(logEntry);

  // 如果没有有效多头信号：只写了 log，不发推送
  if (!(rawSignal === "LONG" && trendOk4h && regimeOk)) {
    console.log(
      "\n>>> 建议：❌ 观望（要么没突破，要么 4H 趋势过滤/日线 Regime 未通过）"
    );
    console.log("（本次状态已写入 signal-log.jsonl）");
    return;
  }

  // === 有有效的多头信号：额外提示 + 推送 ===
  console.log("\n>>> 检测到 ✅ 多头入场信号！（4H + 日线BULL）");
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
  console.log("\n=== 仓位建议（策略账户维度） ===");
  console.log(`策略账户资金: ${accountSize.toFixed(2)} USDT`);
  console.log(
    `本次计划使用: ${capitalToUse.toFixed(2)} USDT (${(capitalPct * 100).toFixed(
      0
    )}% 仓位)`
  );
  console.log(
    `默认杠杆: ${leverage}x, 名义仓位: ${notional.toFixed(
      2
    )} USDT, 建议数量: ${qtyBTC.toFixed(4)} BTC`
  );
  console.log(`日线 Regime: ${dailyRegime}`);

  const title = "BTC 4H 多头信号 (含日线BULL过滤)";
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
    `EMA50(4H): ${e50_4h.toFixed(2)}, EMA200(4H): ${e200_4h.toFixed(2)}`,
    `ATR(4H): ${(atrPct4h * 100).toFixed(2)}%`,
    `日线 Regime: ${dailyRegime}`,
    "",
    `【仓位建议 - 策略账户】`,
    `账户资金: ${accountSize.toFixed(2)} USDT`,
    `本次使用: ${capitalToUse.toFixed(2)} USDT (${(capitalPct * 100).toFixed(
      0
    )}% 仓位)`,
    `默认杠杆: ${leverage}x, 名义仓位: ${notional.toFixed(2)} USDT`,
    `建议下单数量: ${qtyBTC.toFixed(4)} BTC`,
  ].join("\n");

  await sendDiscordNotification({ title, text });

  console.log("\n>>> 已写入 signal-log.jsonl 并尝试发送 Discord 通知。");
}

runOnce().catch((err) => {
  console.error("运行出错:", err);
  process.exit(1);
});