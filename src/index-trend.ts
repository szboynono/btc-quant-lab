import { fetchBtc4hCandles } from "./exchange/binance.js";
import {
  backtestSimpleBtcTrend,
  printBacktestResult,
} from "./backtest/engine.js";

type ParamCombo = {
  useV2Signal: boolean;
  stopLossPct: number;
  takeProfitPct: number;
  minAtrPct: number;
};

async function main() {
  try {
    console.log("正在从Binance获取BTCUSDT 4小时K线...");
    const candles = await fetchBtc4hCandles(3000);
    console.log(`获取到 ${candles.length} 根K线。`);

    // === 1. 划分训练集 / 测试集 ===
    const splitIndex = Math.floor(candles.length * 0.67); // 前 2/3 训练，后 1/3 测试
    const trainCandles = candles.slice(0, splitIndex);
    const testCandles = candles.slice(splitIndex);

    console.log(
      `训练集 K 线: ${trainCandles.length}, 测试集 K 线: ${testCandles.length}`
    );

    // 参数网格
    const slList = [0.015, 0.02];          // 1.5%, 2%
    const tpList = [0.04, 0.05];           // 4%, 5%
    const signalVersions = [false, true];  // false = v1, true = v2
    const atrThreshList = [0.005, 0.01, 0.015]; // 0.5%, 1%, 1.5%

    let bestOnTrain: {
      params: ParamCombo;
      totalReturnPct: number;
      winRate: number;
      totalTrades: number;
    } | null = null;

    console.log("\n=== 训练集参数扫描结果 ===");
    for (const useV2Signal of signalVersions) {
      console.log(`\n--- 使用 ${useV2Signal ? "v2" : "v1"} signal ---`);
      for (const minAtrPct of atrThreshList) {
        console.log(`  >> minAtrPct = ${(minAtrPct * 100).toFixed(2)}%`);
        for (const sl of slList) {
          for (const tp of tpList) {
            const result = backtestSimpleBtcTrend(trainCandles, {
              useTrendFilter: true,
              useV2Signal,
              stopLossPct: sl,
              takeProfitPct: tp,
              minAtrPct, // ✅ 传入 ATR 阈值
            });

            if (!result) continue;

            console.log(
              `    SL=${(sl * 100).toFixed(1)}%  TP=${(tp * 100).toFixed(
                1
              )}% -> 总收益 ${result.totalReturnPct.toFixed(
                2
              )}% | 胜率 ${result.winRate.toFixed(
                2
              )}% | 笔数 ${result.totalTrades}`
            );

            if (
              !bestOnTrain ||
              result.totalReturnPct > bestOnTrain.totalReturnPct
            ) {
              bestOnTrain = {
                params: {
                  useV2Signal,
                  stopLossPct: sl,
                  takeProfitPct: tp,
                  minAtrPct,
                },
                totalReturnPct: result.totalReturnPct,
                winRate: result.winRate,
                totalTrades: result.totalTrades,
              };
            }
          }
        }
      }
    }

    if (!bestOnTrain) {
      console.log("训练集上没有有效结果。");
      return;
    }

    console.log("\n=== 训练集最优参数 ===");
    console.log({
      signal: bestOnTrain.params.useV2Signal ? "v2" : "v1",
      SL: bestOnTrain.params.stopLossPct,
      TP: bestOnTrain.params.takeProfitPct,
      minAtrPct: bestOnTrain.params.minAtrPct,
      totalReturnPct: bestOnTrain.totalReturnPct.toFixed(2) + "%",
      winRate: bestOnTrain.winRate.toFixed(2) + "%",
      trades: bestOnTrain.totalTrades,
    });

    // === 2. 用“训练集最优参数”在测试集上回测 ===
    console.log("\n=== 在测试集上检验最优参数 ===");
    const testResult = backtestSimpleBtcTrend(testCandles, {
      useTrendFilter: true,
      useV2Signal: bestOnTrain.params.useV2Signal,
      stopLossPct: bestOnTrain.params.stopLossPct,
      takeProfitPct: bestOnTrain.params.takeProfitPct,
      minAtrPct: bestOnTrain.params.minAtrPct, // ✅ 同样传入
    });

    if (!testResult) {
      console.log("测试集上回测失败。");
      return;
    }

    printBacktestResult(testResult, testCandles.length);
  } catch (err) {
    console.error("运行出错:", err);
  }
}

main();