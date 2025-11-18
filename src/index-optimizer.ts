// src/index-optimizer.ts
import "dotenv/config";
import fs from "node:fs/promises";

import {
  fetchBtc4hCandles,
  fetchBtc1dCandles,
} from "./exchange/binance.js";

import {
  backtestSimpleBtcTrend,
  type BacktestResult,
  type BacktestOptions,
} from "./backtest/engine.js";

import { ema } from "./indicators/ema.js";
import { detectRegimeFromEma } from "./strategy/regime.js";
import type { Candle } from "./types/candle.js";

import strategy from "./config/strategy.json" with { type: "json" };

// === 配置区 ===

// 是否自动把最优参数写回 config/strategy.json
const AUTO_UPDATE_STRATEGY_JSON = false;

const MIN_TRAIN_TRADES = 3;
const MIN_TEST_TRADES = 2;

// 风险惩罚权重：score = 收益 - ALPHA * 回撤
//（Train 和 Test 都用这个 ALPHA）
const ALPHA = 0.5;

// Train 和 Test 在综合 score 里的权重（更偏向 Test）
const TRAIN_WEIGHT = 0.4;
const TEST_WEIGHT = 0.6;

// 扫描的参数空间：适度拉宽一点
// 止损 0.8% ~ 2.0%
const SL_LIST = [0.008, 0.01, 0.012, 0.015, 0.018, 0.02];
// 止盈 2.5% ~ 5.0%
const TP_LIST = [0.025, 0.03, 0.035, 0.04, 0.045, 0.05];
// ATR 0.3% ~ 1.5%
const ATR_LIST = [0.003, 0.005, 0.0075, 0.01, 0.015];
// false = v1, true = v2
const SIGNAL_VERSIONS: boolean[] = [false, true];

type StrategyConfig = typeof strategy;

type ParamCombo = {
  useV2Signal: boolean;
  stopLossPct: number;
  takeProfitPct: number;
  minAtrPct: number;
};

type ScoredResult = {
  params: ParamCombo;
  train: BacktestResult;
  test: BacktestResult;
  trainScore: number;
  testScore: number;
  jointScore: number;
};

type Regime = "BULL" | "BEAR" | "RANGE";

// 把时间戳归一到“UTC 的日期 key”
function dayKeyFromMs(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
}

/**
 * 基于日线 50/200 EMA，构建一个 Map：
 *   "YYYY-M-D" -> "BULL" | "BEAR" | "RANGE"
 */
function buildDailyRegimeMap(daily: Candle[]): Map<string, Regime> {
  const closes = daily.map((c) => c.close);
  const ema50 = ema(closes, 50);
  const ema200 = ema(closes, 200);

  const map = new Map<string, Regime>();

  for (let i = 200; i < daily.length; i++) {
    const price = closes[i]!;
    const e50 = ema50[i]!;
    const e200 = ema200[i]!;
    const prevE200 = ema200[i - 1]!;

    const { regime } = detectRegimeFromEma(price, e50, e200, prevE200);
    const key = dayKeyFromMs(daily[i]!.closeTime);
    map.set(key, regime as Regime);
  }

  return map;
}

/**
 * 对 4H K 线做回测，但只在「日线 Regime === BULL」的日期上交易。
 * 其它逻辑仍然走 backtestSimpleBtcTrend（里面还有 4H 自己的 EMA Regime）。
 */
function backtestWithDailyRegimeFilter(
  candles4h: Candle[],
  dailyRegimes: Map<string, Regime>,
  options: BacktestOptions
): BacktestResult | null {
  // 只保留“日线 regime 为 BULL 的那几天”的 4H K 线
  const filtered = candles4h.filter((c) => {
    const key = dayKeyFromMs(c.closeTime);
    const regime = dailyRegimes.get(key);
    return regime === "BULL";
  });

  if (filtered.length < 200) {
    // K 线太少，EMA/RSI 暖机不够
    return null;
  }

  return backtestSimpleBtcTrend(filtered, options);
}

async function main() {
  console.log("正在从 binance 获取BTCUSDT 4小时K线...");
  const candles4h = await fetchBtc4hCandles(3000);
  console.log(`4H 获取到 ${candles4h.length} 根K线。`);

  if (candles4h.length < 600) {
    console.log("4H K 线太少，至少需要 600 根。");
    return;
  }

  console.log("正在从 binance 获取BTCUSDT 1天K线...");
  const candles1d = await fetchBtc1dCandles(500);
  console.log(`1D 获取到 ${candles1d.length} 根K线。`);

  const dailyRegimeMap = buildDailyRegimeMap(candles1d);

  // 2/3 训练 + 1/3 测试（在 4H 维度上切）
  const splitIndex = Math.floor(candles4h.length * 0.67);
  const train4h = candles4h.slice(0, splitIndex);
  const test4h = candles4h.slice(splitIndex);

  console.log(
    `训练集 4H K 线: ${train4h.length}, 测试集 4H K 线: ${test4h.length}`
  );

  const allResults: ScoredResult[] = [];

  console.log("\n=== 参数扫描（训练 + 测试一起看，含日线 Regime BULL 过滤） ===");

  for (const useV2Signal of SIGNAL_VERSIONS) {
    console.log(`\n--- 使用 ${useV2Signal ? "v2" : "v1"} signal ---`);
    for (const minAtrPct of ATR_LIST) {
      console.log(`  >> minAtrPct = ${(minAtrPct * 100).toFixed(2)}%`);

      for (const sl of SL_LIST) {
        for (const tp of TP_LIST) {
          const params: ParamCombo = {
            useV2Signal,
            stopLossPct: sl,
            takeProfitPct: tp,
            minAtrPct,
          };

          const backtestOpts: BacktestOptions = {
            useTrendFilter: true,
            ...params,
          };

          // 1) 先跑训练集（带日线 Regime 过滤）
          const train = backtestWithDailyRegimeFilter(
            train4h,
            dailyRegimeMap,
            backtestOpts
          );

          if (!train) continue;
          if (train.totalTrades < MIN_TRAIN_TRADES) {
            console.log(
              `    SL=${(sl * 100).toFixed(1)}%  TP=${(tp * 100).toFixed(
                1
              )}% -> Train 笔数太少(${train.totalTrades})，跳过`
            );
            continue;
          }

          // 2) 再跑测试集（同样带日线 Regime 过滤）
          const test = backtestWithDailyRegimeFilter(
            test4h,
            dailyRegimeMap,
            backtestOpts
          );

          if (!test) continue;
          if (test.totalTrades < MIN_TEST_TRADES) {
            console.log(
              `    SL=${(sl * 100).toFixed(1)}%  TP=${(tp * 100).toFixed(
                1
              )}% -> Test 笔数太少(${test.totalTrades})，跳过`
            );
            continue;
          }

          // 3) 计算 Train / Test 的 score
          const trainScore =
            train.totalReturnPct - ALPHA * train.maxDrawdownPct;
          const testScore =
            test.totalReturnPct - ALPHA * test.maxDrawdownPct;

          const jointScore =
            TRAIN_WEIGHT * trainScore + TEST_WEIGHT * testScore;

          console.log(
            `    SL=${(sl * 100).toFixed(1)}%  TP=${(tp * 100).toFixed(
              1
            )}% -> Train: ${train.totalReturnPct.toFixed(
              2
            )}% / DD ${train.maxDrawdownPct.toFixed(
              2
            )}% / 笔数 ${train.totalTrades} | ` +
              `Test: ${test.totalReturnPct.toFixed(
                2
              )}% / DD ${test.maxDrawdownPct.toFixed(
                2
              )}% / 笔数 ${test.totalTrades} | ` +
              `score=${jointScore.toFixed(2)}`
          );

          allResults.push({
            params,
            train,
            test,
            trainScore,
            testScore,
            jointScore,
          });
        }
      }
    }
  }

  if (allResults.length === 0) {
    console.log(
      "\n⚠️ 没有任何同时满足 Train / Test 笔数要求的参数组合，请考虑放宽 MIN_TRAIN_TRADES 或 MIN_TEST_TRADES。"
    );
    return;
  }

  // 按综合 score 排序（越大越好）
  allResults.sort((a, b) => b.jointScore - a.jointScore);
  const best = allResults[0]!;

  console.log("\n=== 最优参数（综合 Train + Test 的 jointScore） ===");
  console.log({
    useV2Signal: best.params.useV2Signal,
    stopLossPct: best.params.stopLossPct,
    takeProfitPct: best.params.takeProfitPct,
    minAtrPct: best.params.minAtrPct,

    trainReturn: best.train.totalReturnPct.toFixed(2) + "%",
    trainDD: best.train.maxDrawdownPct.toFixed(2) + "%",
    trainTrades: best.train.totalTrades,
    trainAnnualized: best.train.annualizedReturnPct.toFixed(2) + "%",

    testReturn: best.test.totalReturnPct.toFixed(2) + "%",
    testDD: best.test.maxDrawdownPct.toFixed(2) + "%",
    testTrades: best.test.totalTrades,
    testAnnualized: best.test.annualizedReturnPct.toFixed(2) + "%",

    trainScore: best.trainScore.toFixed(2),
    testScore: best.testScore.toFixed(2),
    jointScore: best.jointScore.toFixed(2),
  });

  // 也顺便打印一下 “前几名参数”，方便你肉眼感受一下
  const topN = 5;
  console.log(`\n=== 前 ${topN} 名参数概览（按 jointScore 排序） ===`);
  for (const [idx, r] of allResults.slice(0, topN).entries()) {
    console.log(`#${idx + 1}`, {
      useV2Signal: r.params.useV2Signal,
      SL: r.params.stopLossPct,
      TP: r.params.takeProfitPct,
      minAtrPct: r.params.minAtrPct,
      trainRet: r.train.totalReturnPct.toFixed(2) + "%",
      testRet: r.test.totalReturnPct.toFixed(2) + "%",
      jointScore: r.jointScore.toFixed(2),
    });
  }

  // === 可选：自动写回 strategy.json ===
  if (AUTO_UPDATE_STRATEGY_JSON) {
    await updateStrategyJson(best.params);
  } else {
    console.log(
      "\n💾 提示：如果你想让最优参数自动写回 config/strategy.json，" +
        "请把 index-optimizer.ts 顶部的 AUTO_UPDATE_STRATEGY_JSON 改成 true。"
    );
    console.log("然后 live 策略的参数就会自动跟着更新。");
  }
}

async function updateStrategyJson(bestParams: ParamCombo) {
  console.log("\n=== 正在更新 config/strategy.json ===");

  const newConfig: StrategyConfig = {
    ...strategy,
    useTrendFilter: true,
    useV2Signal: bestParams.useV2Signal,
    stopLossPct: bestParams.stopLossPct,
    takeProfitPct: bestParams.takeProfitPct,
    minAtrPct: bestParams.minAtrPct,
  };

  const strategyUrl = new URL("./config/strategy.json", import.meta.url);

  await fs.writeFile(
    strategyUrl,
    JSON.stringify(newConfig, null, 2),
    "utf-8"
  );

  console.log("✅ 已写回 config/strategy.json ：");
  console.log(newConfig);
}

main().catch((err) => {
  console.error("运行出错:", err);
  process.exit(1);
});