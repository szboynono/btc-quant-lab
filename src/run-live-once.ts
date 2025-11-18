// src/run-live-once.ts
import "dotenv/config";
// import { fetchBtc4hCandles } from "./exchange/binance.js";
import { fetchBtc4hCandles, fetchBtc1dCandles } from "./exchange/htx.js";
import type { Candle } from "./types/candle.js";
import { ema } from "./indicators/ema.js";
import { atr } from "./indicators/atr.js";
import { detectSignal } from "./strategy/simple-trend.js";
import { detectSignalV2 } from "./strategy/simple-trend-v2.js";
import { appendSignalLog } from "./log/signal-log.js";

// 日线 Regime 计算，名字按你 backtest 那个来，如果你叫别的，改一下这里的 import 即可
import { computeDailyRegimes } from "./strategy/regime.js";

import strategy from "./config/strategy.json" with { type: "json" };
import position from "./config/position.json" with { type: "json" };

const CONFIG = strategy;
const POSITION = position;

async function main() {
  console.log("正在从 HTX 获取BTCUSDT 4小时K线...");
  const candles4h = await fetchBtc4hCandles(3000);
  console.log(`4H 获取到 ${candles4h.length} 根K线。`);

  if (candles4h.length < 210) {
    console.log("4H K线太少，无法进行分析。");
    return;
  }

  console.log("正在从 HTX 获取BTCUSDT 1天K线...");
  const candles1d = await fetchBtc1dCandles(500);
  console.log(`1D 获取到 ${candles1d.length} 根K线。`);

  if (candles1d.length < 50) {
    console.log("1D 日线太少，无法进行 Regime 分析。");
    return;
  }

  // 计算日线 Regime（跟 backtest 一致）
  const regimes = computeDailyRegimes(candles1d);
  const recentRegimes = regimes.slice(-5);

  console.log("\n=== 日线 Regime 统计（最近几天） ===");
  console.log(JSON.stringify(recentRegimes, null, 2));

  const latestRegime = regimes[regimes.length - 1]?.regime ?? "UNKNOWN";
  console.log("当前最新日线 Regime:", latestRegime);

  await analyzeLatestCandle(candles4h, CONFIG, latestRegime);
}

async function analyzeLatestCandle(
  candles: Candle[],
  cfg: typeof CONFIG,
  dailyRegime: string
): Promise<void> {
  const closes = candles.map((c) => c.close);
  const ema50 = ema(closes, 50);
  const ema200 = ema(closes, 200);
  const atr14 = atr(candles, 14);

  const lastIndex = candles.length - 1;
  const lastCandle = candles[lastIndex]!;
  const prevCandle = candles[lastIndex - 1]!;

  const price = lastCandle.close;
  const prevPrice = prevCandle.close;

  const e50 = ema50[lastIndex]!;
  const prevE50 = ema50[lastIndex - 1]!;
  const e200 = ema200[lastIndex]!;
  const prevE200 = ema200[lastIndex - 1]!;

  const atrValue = atr14[lastIndex];

  if (atrValue === undefined) {
    console.log("ATR 数据不足，无法分析。");
    return;
  }

  const atrPct = (atrValue / price) * 100; // 转成百分比展示
  const ema200Slope = e200 - prevE200;

  console.log("\n=== 当前 4H K 线状态 ===");
  console.log("收盘时间:", new Date(lastCandle.closeTime).toISOString());
  console.log("收盘价格:", price.toFixed(2));
  console.log("EMA50:", e50.toFixed(2));
  console.log("EMA200:", e200.toFixed(2));
  console.log(`ATR(14): ${atrValue.toFixed(2)} (${atrPct.toFixed(2)}%)`);
  console.log("200EMA 斜率:", ema200Slope.toFixed(4));

  // === 趋势过滤（4H）===
  const isUpTrend = price > e200 && e50 > e200;
  const strongSlope = ema200Slope > 0;
  const enoughVol = atrValue / price > cfg.minAtrPct;

  const trendOk = cfg.useTrendFilter ? (isUpTrend && strongSlope && enoughVol) : true;

  console.log("\n=== 趋势过滤（4H） ===");
  console.log("多头结构 (price > EMA200 && EMA50 > EMA200):", isUpTrend);
  console.log("200EMA 向上 (slope > 0):", strongSlope);
  console.log(
    `波动率足够 (ATR/price > minAtrPct):`,
    enoughVol,
    `, minAtrPct=${(cfg.minAtrPct * 100).toFixed(2)}%`
  );

  // === 日线 Regime 过滤：只在 BULL 才开多 ===
  const regimeOk = dailyRegime === "BULL";
  console.log("\n=== 日线 Regime 过滤 ===");
  console.log("当前 Regime:", dailyRegime, "→ 允许开多(BULL):", regimeOk);

  // === 信号判断（当前假设没有持仓） ===
  let rawSignal: "LONG" | "CLOSE_LONG" | "HOLD";

  if (cfg.useV2Signal) {
    rawSignal = detectSignalV2(candles, lastIndex, ema50, ema200, false);
  } else {
    rawSignal = detectSignal(price, prevPrice, e50, prevE50, false);
  }

  console.log("\n=== 信号判断（假设当前空仓） ===");
  console.log("原始信号 rawSignal:", rawSignal);
  console.log("trendOk:", trendOk);
  console.log("regimeOk:", regimeOk);

  if (rawSignal !== "LONG" || !trendOk || !regimeOk) {
    console.log(
      "\n>>> 建议：❌ 观望（原因可能是：无多头信号 / 4H 趋势不过滤 / 日线 Regime 非 BULL）"
    );
    return;
  }

  // === 可以开多，给出完整交易计划 ===
  const entryPrice = price;
  const stopPrice = entryPrice * (1 - cfg.stopLossPct);
  const tpPrice = entryPrice * (1 + cfg.takeProfitPct);

  const rr = cfg.takeProfitPct / cfg.stopLossPct;

  const slPct = -cfg.stopLossPct * 100;
  const tpPct = cfg.takeProfitPct * 100;

  // === 仓位建议（从 position.json 读） ===
  const accountSize = POSITION.accountSizeUSDT;
  const capitalPct = POSITION.capitalPctPerTrade; // 0~1
  const leverage = POSITION.defaultLeverage;

  const capitalToUse = accountSize * capitalPct; // 本次计划用多少USDT
  const notional = capitalToUse * leverage;      // 名义仓位
  const qtyBTC = notional / entryPrice;          // 建议下单 BTC 数量

  console.log("\n>>> 建议：✅ 可以考虑开多（满足日线 BULL + 4H 趋势 + 突破信号）");
  console.log("建议开仓价(参考):", entryPrice.toFixed(2));
  console.log(
    `止损价 (${(cfg.stopLossPct * 100).toFixed(2)}%):`,
    stopPrice.toFixed(2)
  );
  console.log(
    `止盈价 (${(cfg.takeProfitPct * 100).toFixed(2)}%):`,
    tpPrice.toFixed(2)
  );
  console.log(`名义盈亏比 (R:R): 1 : ${rr.toFixed(2)}`);

  console.log("\n=== 仓位建议 ===");
  console.log(
    `本次计划使用资金: ${capitalToUse.toFixed(2)} USDT ` +
      `(${(capitalPct * 100).toFixed(0)}% 仓位)`
  );
  console.log(`杠杆: ${leverage}x`);
  console.log(`名义仓位: ${notional.toFixed(2)} USDT`);
  console.log(`建议下单数量: ${qtyBTC.toFixed(4)} BTC`);

  // === 杠杆情景说明（不含手续费） ===
  console.log("\n=== 杠杆盈亏大致参考（不含手续费） ===");
  const leverages = [3, 5];
  for (const lev of leverages) {
    const lossPctOnEquity = cfg.stopLossPct * lev * 100; // 百分比
    const gainPctOnEquity = cfg.takeProfitPct * lev * 100;

    console.log(`\n--- 杠杆 ${lev}x ---`);
    console.log(
      `价格触及止损，大约亏损: ${lossPctOnEquity.toFixed(2)}% 账户权益`
    );
    console.log(
      `价格触及止盈，大约盈利: ${gainPctOnEquity.toFixed(2)}% 账户权益`
    );
  }

  console.log(
    "\n⚠️ 提醒：上面只是按\"策略账户\" + \"默认杠杆\"估算。\n" +
      "    你实际可以：\n" +
      "    - 只用整体资金的一部分做策略账户（比如 1000U / 3000U）\n" +
      "    - 在 3x-5x 内选一个你心理舒服的档位。"
  );

  // === 写入日志 ===
  await appendSignalLog({
    time: new Date(lastCandle.closeTime).toISOString(),
    price: entryPrice,
    stopLoss: stopPrice,
    takeProfit: tpPrice,
    rawSignal,
    trendOk,
    dailyRegime,
    ema50: e50,
    ema200: e200,
    atrPct: (atrValue / price) * 100,
    leverage3x: { slPctOnEquity: slPct * 3, tpPctOnEquity: tpPct * 3 },
    leverage5x: { slPctOnEquity: slPct * 5, tpPctOnEquity: tpPct * 5 },
    positionSuggestion: {
      accountSizeUSDT: accountSize,
      capitalPctPerTrade: capitalPct,
      leverage,
      capitalToUse,
      notional,
      qtyBTC,
    },
  });

  console.log("\n>>> 已写入 signal-log.jsonl");
}

main().catch((err) => {
  console.error("运行出错:", err);
  process.exit(1);
});