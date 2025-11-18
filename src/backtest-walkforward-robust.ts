// src/backtest-walkforward-robust.ts
import "dotenv/config";
import type { Candle } from "./types/candle.js";

import {
  fetchBtc4hCandles,
  fetchBtc1dCandles,
} from "./exchange/binance.js";

import { runBacktestWithConfig } from "./backtest-regime.js";
import strategy from "./config/strategy.json" with { type: "json" };

const BASE_STRATEGY = strategy;

// 你可以按需要调整这两个窗口长度
const TRAIN_DAYS = 365; // 每个窗口训练 365 天
const TEST_DAYS = 90;   // 每个窗口测试 90 天

type BacktestResult = {
  totalReturnPct: number;      // 总收益（12.34 表示 12.34%）
  maxDrawdownPct: number;      // 最大回撤
  trades: number;              // 交易笔数
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

type StrategyConfig = typeof BASE_STRATEGY;

type ConfigVariant = {
  name: string;
  cfg: StrategyConfig;
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

/**
 * 基于当前 strategy.json 生成一组“轻微扰动”的配置
 * - base: 原始参数
 * - SL ± 0.001 (0.1%)
 * - TP ± 0.01  (1%)
 * - minAtrPct ± 0.0025 (0.25%)
 */
function makeConfigVariants(base: StrategyConfig): ConfigVariant[] {
  const baseSL = base.stopLossPct ?? 0.008;
  const baseTP = base.takeProfitPct ?? 0.05;
  const baseAtr = base.minAtrPct ?? 0.0075;

  const variants: ConfigVariant[] = [];

  // helper: 复制一份 cfg
  const clone = (overrides: Partial<StrategyConfig>): StrategyConfig =>
    ({
      ...base,
      ...overrides,
    } as StrategyConfig);

  // 1) 原始配置
  variants.push({
    name: "base",
    cfg: clone({}),
  });

  // 2) SL 轻微扰动
  variants.push({
    name: `SL-0.001`,
    cfg: clone({
      stopLossPct: Math.max(baseSL - 0.001, 0.0005),
    }),
  });
  variants.push({
    name: `SL+0.001`,
    cfg: clone({
      stopLossPct: baseSL + 0.001,
    }),
  });

  // 3) TP 轻微扰动
  variants.push({
    name: `TP-0.01`,
    cfg: clone({
      takeProfitPct: Math.max(baseTP - 0.01, 0.01),
    }),
  });
  variants.push({
    name: `TP+0.01`,
    cfg: clone({
      takeProfitPct: baseTP + 0.01,
    }),
  });

  // 4) minAtrPct 轻微扰动
  variants.push({
    name: `ATR-0.0025`,
    cfg: clone({
      minAtrPct: Math.max(baseAtr - 0.0025, 0.001),
    }),
  });
  variants.push({
    name: `ATR+0.0025`,
    cfg: clone({
      minAtrPct: baseAtr + 0.0025,
    }),
  });

  return variants;
}

async function runWalkForwardForConfig(
  candles4h: Candle[],
  candles1d: Candle[],
  cfgVariant: ConfigVariant
): Promise<{ variant: ConfigVariant; windows: WindowResult[] }> {
  const { name } = cfgVariant;

  const firstTime = candles4h[0]!.openTime;
  const lastTime = candles4h[candles4h.length - 1]!.closeTime;

  const dayMs = 24 * 60 * 60 * 1000;
  const trainMs = TRAIN_DAYS * dayMs;
  const testMs = TEST_DAYS * dayMs;

  const windowResults: WindowResult[] = [];

  let windowIndex = 0;
  let cursor = firstTime;

  console.log(
    `\n============================\n` +
      `▶️ 配置: ${name}\n` +
      `stopLossPct = ${(cfgVariant.cfg.stopLossPct ?? 0) * 100}%  ` +
      `takeProfitPct = ${(cfgVariant.cfg.takeProfitPct ?? 0) * 100}%  ` +
      `minAtrPct = ${(cfgVariant.cfg.minAtrPct ?? 0) * 100}%\n` +
      `============================`
  );

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

    // 测试窗口超过历史末尾，就退出
    if (testEnd > lastTime) {
      break;
    }

    const train4h = sliceByTime(candles4h, trainStart, trainEnd);
    const test4h = sliceByTime(candles4h, testStart, testEnd);

    // ✅ 日线不再切片，统一用完整的 candles1d
    // const train1d = sliceByTime(candles1d, trainStart, trainEnd);
    // const test1d = sliceByTime(candles1d, testStart, testEnd);

    // 简单防御：窗口里 4H K 线太少就跳过
    if (train4h.length < 200 || test4h.length < 50) {
      cursor += testMs; // 滚动一个测试窗口
      continue;
    }

    windowIndex += 1;

    console.log(`\n=== 窗口 #${windowIndex} (${name}) ===`);
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

    const trainBacktest: any = await runBacktestWithConfig(
      train4h,
      candles1d,        // ✅ 用完整 1D
      cfgVariant.cfg
    );
    const testBacktest: any = await runBacktestWithConfig(
      test4h,
      candles1d,        // ✅ 用完整 1D
      cfgVariant.cfg
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
    console.log(`\n配置 ${name}：没有有效的 Walk-Forward 窗口。`);
  }

  return { variant: cfgVariant, windows: windowResults };
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

  const variants = makeConfigVariants(BASE_STRATEGY);

  const allResults: {
    name: string;
    windows: WindowResult[];
    avgTestRet: number;
    worstTestRet: number;
    worstTestDD: number;
  }[] = [];

  for (const v of variants) {
    const { variant, windows } = await runWalkForwardForConfig(
      candles4h,
      candles1d,
      v
    );

    if (windows.length === 0) {
      allResults.push({
        name: variant.name,
        windows,
        avgTestRet: NaN,
        worstTestRet: NaN,
        worstTestDD: NaN,
      });
      continue;
    }

    const testReturns = windows.map((w) => w.test.totalReturnPct);
    const testDDs = windows.map((w) => w.test.maxDrawdownPct);

    const avgTestRet =
      testReturns.reduce((a, b) => a + b, 0) / testReturns.length;
    const worstTestRet = Math.min(...testReturns);
    const worstTestDD = Math.max(...testDDs);

    allResults.push({
      name: variant.name,
      windows,
      avgTestRet,
      worstTestRet,
      worstTestDD,
    });
  }

  // === 汇总对比 ===
  console.log("\n\n================ 总结：各参数配置 Walk-Forward 表现 ================");
  console.log(
    "配置名 | 窗口数 | 平均 Test 收益% | 最差 Test 收益% | 最坏 Test 回撤%"
  );
  console.log("------------------------------------------------------------------");

  // 可以按平均 Test 收益排序（也可以换成别的排序方式）
  allResults
    .slice()
    .sort((a, b) => {
      // NaN 放后面
      if (isNaN(a.avgTestRet)) return 1;
      if (isNaN(b.avgTestRet)) return -1;
      return b.avgTestRet - a.avgTestRet;
    })
    .forEach((r) => {
      const avg = isNaN(r.avgTestRet) ? "NaN" : r.avgTestRet.toFixed(2);
      const worstRet = isNaN(r.worstTestRet)
        ? "NaN"
        : r.worstTestRet.toFixed(2);
      const worstDD = isNaN(r.worstTestDD)
        ? "NaN"
        : r.worstTestDD.toFixed(2);

      console.log(
        `${r.name.padEnd(8)} | ${r.windows.length
          .toString()
          .padStart(3)}    | ${avg.padStart(
          8
        )}           | ${worstRet.padStart(
          8
        )}           | ${worstDD.padStart(8)}`
      );
    });

  console.log(
    "\n提示：优先考虑那种 “base 附近的几组参数都能保持 Test 为正 & 回撤可控” 的配置，说明策略对参数不敏感，更稳。"
  );
}

main().catch((err) => {
  console.error("运行出错:", err);
  process.exit(1);
});