// src/run-live-once.ts
import { fetchBtc4hCandles } from "./exchange/binance.js";
import { ema } from "./indicators/ema.js";
import { atr } from "./indicators/atr.js";
import { detectSignal } from "./strategy/simple-trend.js";
// 如果你要切 v2，再引入：
// import { detectSignalV2 } from "./strategy/simple-trend-v2.js";

import type { Candle } from "./types/candle.js";

// 和你现在回测用的一样参数（v1 强趋势版）
const CONFIG = {
  useV2Signal: false,
  stopLossPct: 0.015, // 1.5% SL
  takeProfitPct: 0.04, // 4% TP
  minAtrPct: 0.01, // ATR >= 1%
};

async function main() {
  console.log("正在从Binance获取BTCUSDT 4小时K线...");
  const candles = await fetchBtc4hCandles(3000);
  console.log(`获取到 ${candles.length} 根K线。`);

  if (candles.length < 210) {
    console.log("K线太少，至少需要 210 根以上。");
    return;
  }

  // 用最近的这批 K，计算 EMA/ATR
  const closes = candles.map((c) => c.close);
  const ema50 = ema(closes, 50);
  const ema200 = ema(closes, 200);
  const atr14 = atr(candles, 14);

  // 取“最新一根已经收盘的 K”
  const i = candles.length - 1;
  const cur: Candle = candles[i]!;
  const prev: Candle = candles[i - 1]!;

  const price = cur.close;
  const prevPrice = prev.close;

  const e50 = ema50[i]!;
  const prevE50 = ema50[i - 1]!;
  const e200 = ema200[i]!;
  const prevE200 = ema200[i - 1]!;
  const atrValue = atr14[i];

  if (
    e50 === undefined ||
    prevE50 === undefined ||
    e200 === undefined ||
    prevE200 === undefined ||
    atrValue === undefined
  ) {
    console.log("指标暖机不足，无法计算当前信号。");
    return;
  }

  const atrPct = atrValue / price;
  const ema200Slope = e200 - prevE200;

  // ===== 趋势 + 波动过滤（和回测里保持一致） =====
  const isUpTrend = price > e200 && e50 > e200;
  const strongSlope = ema200Slope > 0; // 200EMA 要往上
  const enoughVol = atrPct > CONFIG.minAtrPct; // ATR 占比要 > 阈值

  const trendOk = isUpTrend && strongSlope && enoughVol;

  // ===== 信号判定（现在用 v1 简单突破） =====
  // 如果以后要切 v2，这里改成 detectSignalV2(...)
  const rawSignal = detectSignal(price, prevPrice, e50, prevE50, false);
  // const rawSignal = CONFIG.useV2Signal
  //   ? detectSignalV2(candles, i, ema50, ema200, false)
  //   : detectSignal(price, prevPrice, e50, prevE50, false);

  // 我们假设当前是“空仓”，所以只关心要不要开多
  const wantLong = rawSignal === "LONG" && trendOk;

  // ===== 计算 SL / TP =====
  const stopPrice = price * (1 - CONFIG.stopLossPct);
  const tpPrice = price * (1 + CONFIG.takeProfitPct);

  console.log("\n=== 当前 4H K 线状态 ===");
  console.log("收盘时间:", new Date(cur.closeTime).toISOString());
  console.log("收盘价格:", price.toFixed(2));
  console.log("EMA50:", e50.toFixed(2));
  console.log("EMA200:", e200.toFixed(2));
  console.log("ATR(14):", atrValue.toFixed(2), `(${(atrPct * 100).toFixed(2)}%)`);
  console.log("200EMA 斜率:", ema200Slope.toFixed(4));

  console.log("\n=== 趋势过滤 ===");
  console.log("多头结构 (price > EMA200 && EMA50 > EMA200):", isUpTrend);
  console.log("200EMA 向上 (slope > 0):", strongSlope);
  console.log(
    "波动率足够 (ATR/price > minAtrPct):",
    enoughVol,
    `, minAtrPct=${(CONFIG.minAtrPct * 100).toFixed(2)}%`
  );

  console.log("\n=== 信号判断（假设当前空仓） ===");
  console.log("原始信号 rawSignal:", rawSignal);
  console.log("trendOk:", trendOk);

  if (wantLong) {
    console.log("\n>>> 建议：✅ 开多（符合趋势 + 信号）");
    console.log(`建议开仓价（参考当前收盘价）: ~${price.toFixed(2)}`);
    console.log(
      `止损价 (${(CONFIG.stopLossPct * 100).toFixed(2)}%): ${stopPrice.toFixed(
        2
      )}`
    );
    console.log(
      `止盈价 (${(CONFIG.takeProfitPct * 100).toFixed(2)}%): ${tpPrice.toFixed(
        2
      )}`
    );

    console.log("\n如果用 3x / 5x 杠杆，可以这么理解（只是示例）：");
    const capital = 1000; // 举例 1000u 资金
    const notional3x = capital * 3;
    const notional5x = capital * 5;
    console.log(
      `- 3x: 资金 1000u → 仓位约 ${notional3x.toFixed(
        0
      )}u，理论 SL 约损失 ${(CONFIG.stopLossPct * 3 * 100).toFixed(2)}% 资金`
    );
    console.log(
      `- 5x: 资金 1000u → 仓位约 ${notional5x.toFixed(
        0
      )}u，理论 SL 约损失 ${(CONFIG.stopLossPct * 5 * 100).toFixed(2)}% 资金`
    );
  } else {
    console.log("\n>>> 建议：❌ 观望（要么没突破，要么趋势过滤不通过）");
  }
}

main().catch((err) => {
  console.error("运行出错:", err);
});