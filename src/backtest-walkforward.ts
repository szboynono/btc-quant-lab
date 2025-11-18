// src/backtest-walkforward.ts
import "dotenv/config";
import type { Candle } from "./types/candle.js";

import {
  fetchBtc4hCandles,
  fetchBtc1dCandles,
} from "./exchange/binance.js";

import { runBacktestWithConfig } from "./backtest-regime.js";

import strategy from "./config/strategy.json" with { type: "json" };

const STRATEGY_CFG = strategy;

// 可调
const TRAIN_DAYS = 365;
const TEST_DAYS = 90;

type BacktestResult = {
  totalReturnPct: number;
  maxDrawdownPct: number;
  trades: number;
  annualizedReturnPct?: number;
};

type WindowResult = {
  index: number;
  trainStart: Date;
  trainEnd: Date;
  testStart: Date;
  testEnd: Date;
  train: BacktestResult;
  test: BacktestResult;
};

function sliceByTime(
  candles: Candle[],
  startMs: number,
  endMs: number
): Candle[] {
  return candles.filter(
    (c) => c.openTime >= startMs && c.closeTime <= endMs
  );
}

function toDate(ms: number): Date {
  return new Date(ms);
}

async function main() {
  console.log("正在从 binance 获取BTCUSDT 4小时K线...");
  const candles4h = await fetchBtc4hCandles(3000);
  console.log("4H 获取到 K 线数量:", candles4h.length);

  console.log("正在从 binance 获取BTCUSDT 1天K线...");
  const candles1d = await fetchBtc1dCandles(500);
  console.log("1D 获取到 K 线数量:", candles1d.length);

  if (candles4h.length < 500 || candles1d.length < 200) {
    console.log("历史数据太少，无法进行 Walk-Forward。");
    return;
  }

  const firstTime = candles4h[0]!.openTime;
  const lastTime = candles4h[candles4h.length - 1]!.closeTime;

  const dayMs = 24 * 60 * 60 * 1000;
  const trainMs = TRAIN_DAYS * dayMs;
  const testMs = TEST_DAYS * dayMs;

  const windowResults: WindowResult[] = [];

  let windowIndex = 0;
  let cursor = firstTime;

  console.log("\n=== Walk-Forward 参数 ===");
  console.log(`训练窗口: ${TRAIN_DAYS} 天`);
  console.log(`测试窗口: ${TEST_DAYS} 天`);
  console.log(
    `时间范围: ${new Date(firstTime).toISOString()} ~ ${new Date(
      lastTime
    ).toISOString()}`
  );

  while (true) {
    const trainStart = cursor;
    const trainEnd = trainStart + trainMs;
    const testStart = trainEnd;
    const testEnd = testStart + testMs;

    if (testEnd > lastTime) {
      break;
    }

    // 4H 按窗口切
    const train4h = sliceByTime(candles4h, trainStart, trainEnd);
    const test4h = sliceByTime(candles4h, testStart, testEnd);

    if (train4h.length < 200 || test4h.length < 50) {
      cursor += testMs;
      continue;
    }

    windowIndex += 1;

    console.log(`\n=== 窗口 #${windowIndex} ===`);
    console.log(
      `Train: ${toDate(trainStart).toISOString()} ~ ${toDate(
        trainEnd
      ).toISOString()}`
    );
    console.log(
      `Test : ${toDate(testStart).toISOString()} ~ ${toDate(
        testEnd
      ).toISOString()}`
    );
    console.log(
      `Train 4H 根数: ${train4h.length}, Test 4H 根数: ${test4h.length}`
    );

    // ⭐ 日线不按窗口切，直接用完整 1D 历史
    const trainBacktest = runBacktestWithConfig(
      train4h,
      candles1d,
      STRATEGY_CFG
    );

    const testBacktest = runBacktestWithConfig(
      test4h,
      candles1d,
      STRATEGY_CFG
    );

    if (!trainBacktest?.result || !testBacktest?.result) {
      console.log("  跳过：Train 或 Test 回测失败（K线不足或参数问题）");
      cursor += testMs;
      continue;
    }

    const trainRes: BacktestResult = {
      totalReturnPct: trainBacktest.result.totalReturnPct,
      maxDrawdownPct: trainBacktest.result.maxDrawdownPct,
      trades: trainBacktest.result.totalTrades,
      annualizedReturnPct: trainBacktest.result.annualizedReturnPct,
    };

    const testRes: BacktestResult = {
      totalReturnPct: testBacktest.result.totalReturnPct,
      maxDrawdownPct: testBacktest.result.maxDrawdownPct,
      trades: testBacktest.result.totalTrades,
      annualizedReturnPct: testBacktest.result.annualizedReturnPct,
    };

    console.log(
      `Train 结果: 收益 ${trainRes.totalReturnPct.toFixed(
        2
      )}% / DD ${trainRes.maxDrawdownPct.toFixed(2)}% / 笔数 ${
        trainRes.trades
      }`
    );
    console.log(
      `Test  结果: 收益 ${testRes.totalReturnPct.toFixed(
        2
      )}% / DD ${testRes.maxDrawdownPct.toFixed(2)}% / 笔数 ${
        testRes.trades
      }`
    );

    windowResults.push({
      index: windowIndex,
      trainStart: toDate(trainStart),
      trainEnd: toDate(trainEnd),
      testStart: toDate(testStart),
      testEnd: toDate(testEnd),
      train: trainRes,
      test: testRes,
    });

    cursor += testMs;
  }

  if (windowResults.length === 0) {
    console.log("\n没有有效的 Walk-Forward 窗口（可能历史太短）。");
    return;
  }

  const testReturns = windowResults.map((w) => w.test.totalReturnPct);
  const testDDs = windowResults.map((w) => w.test.maxDrawdownPct);

  const avgTestRet =
    testReturns.reduce((a, b) => a + b, 0) / testReturns.length;
  const worstTestRet = Math.min(...testReturns);
  const worstTestDD = Math.max(...testDDs);

  console.log("\n=== Walk-Forward 总结（按 Test 段） ===");
  console.log(`窗口数量: ${windowResults.length}`);
  console.log(`平均 Test 收益: ${avgTestRet.toFixed(2)}%`);
  console.log(`最差单个 Test 收益: ${worstTestRet.toFixed(2)}%`);
  console.log(
    `所有窗口里最坏 Test 最大回撤: ${worstTestDD.toFixed(2)}%`
  );

  console.log(
    "\n提示：如果大部分窗口的 Test 收益为正，且最坏回撤在你能接受的范围内，" +
      "说明你现在这套 strategy.json 参数在不同周期下表现还算稳定。"
  );
}

main().catch((err) => {
  console.error("运行出错:", err);
  process.exit(1);
});