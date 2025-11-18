// src/index-backtest-regime.ts
import "dotenv/config";
import { fetchBtc4hCandles, fetchBtc1dCandles } from "./exchange/binance.js";
import {
  backtestSimpleBtcTrend,
  printBacktestResult,
  type RegimeType,
} from "./backtest/engine.js";
import { ema } from "./indicators/ema.js";
import { detectRegimeFromEma } from "./strategy/regime.js";
import strategy from "./config/strategy.json" with { type: "json" };

type StrategyConfig = typeof strategy;

async function main() {
  console.log("正在从 Binance 获取BTCUSDT 4小时K线...");
  const candles4h = await fetchBtc4hCandles(3000);
  console.log(`4H K 线数量: ${candles4h.length}`);

  console.log("正在从 Binance 获取BTCUSDT 1天K线...");
  const candles1d = await fetchBtc1dCandles(500); // 一般 1–2 年够用了
  console.log(`1D K 线数量: ${candles1d.length}`);

  if (candles4h.length < 200 || candles1d.length < 200) {
    console.log("K 线太少，至少要 200 根+ 才能跑回测。");
    return;
  }

  // === 1. 先在日线上算 50/200 EMA，标记 Regime ===
  const dailyCloses = candles1d.map((c) => c.close);
  const dEma50 = ema(dailyCloses, 50);
  const dEma200 = ema(dailyCloses, 200);

  const dailyTimes: number[] = [];
  const dailyRegimes: RegimeType[] = [];

  for (let i = 200; i < candles1d.length; i++) {
    const price = dailyCloses[i]!;
    const e50 = dEma50[i]!;
    const e200 = dEma200[i]!;
    const prevE200 = dEma200[i - 1]!;

    const { regime } = detectRegimeFromEma(price, e50, e200, prevE200);

    dailyTimes.push(candles1d[i]!.closeTime);
    dailyRegimes.push(regime);
  }

  console.log("\n=== 日线 Regime 统计（最近几天） ===");
  const lastRegimes = dailyRegimes.slice(-5).map((r, idx) => ({
    date: new Date(dailyTimes[dailyTimes.length - 5 + idx]!).toISOString(),
    regime: r,
  }));
  console.log(lastRegimes);

  // === 2. 把 JSON 里的参数 + 日线 Regime 传给回测引擎 ===
  const cfg: StrategyConfig = strategy;

  console.log("\n=== 强趋势策略（JSON 配置 + 日线 Regime 过滤） ===");
  console.log(cfg);

  const result = backtestSimpleBtcTrend(candles4h, {
    useTrendFilter: cfg.useTrendFilter ?? true,
    useV2Signal: cfg.useV2Signal ?? false,
    stopLossPct: cfg.stopLossPct ?? 0.015,
    takeProfitPct: cfg.takeProfitPct ?? 0.04,
    minAtrPct: cfg.minAtrPct ?? 0.005,
    // RSI 若你没写在 JSON，就用默认 30–70
    maxRsiForEntry: (cfg as any).maxRsiForEntry ?? 70,
    minRsiForEntry: (cfg as any).minRsiForEntry ?? 30,

    // ✅ 关键：把日线 regime 串给引擎
    higherTFRegime: {
      times: dailyTimes,
      regimes: dailyRegimes,
    },
    // 只在日线 BULL 时开多
    allowedHigherTFRegimes: ["BULL"],
  });

  if (!result) {
    console.log("回测无结果（可能K线不足或参数异常）。");
    return;
  }

  console.log("");
  printBacktestResult(result, candles4h.length);
}

main().catch((err) => {
  console.error("运行出错:", err);
  process.exit(1);
});