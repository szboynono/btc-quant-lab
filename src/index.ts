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

    // === 1. 训练集 & 测试集切分 ===
    const splitIndex = Math.floor(candles.length * 0.67);
    const trainCandles = candles.slice(0, splitIndex);
    const testCandles = candles.slice(splitIndex);

    console.log(
      `训练集 K 线: ${trainCandles.length}, 测试集 K 线: ${testCandles.length}`
    );

    // 参数空间
    const slList = [0.015, 0.02];
    const tpList = [0.04, 0.05];
    const signalVersions = [false, true];
    const atrThreshList = [0.005, 0.01, 0.015];

    // 引入风险惩罚因子
    const alpha = 0.5; // 惩罚回撤权重，可调

    let bestOnTrain: any = null;

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
              minAtrPct,
            });

            if (!result) continue;

            console.log(
              `    SL=${(sl * 100).toFixed(1)}%  TP=${(tp * 100).toFixed(
                1
              )}% -> 总收益 ${result.totalReturnPct.toFixed(
                2
              )}% | 胜率 ${result.winRate.toFixed(2)}% | 笔数 ${
                result.totalTrades
              } | 回撤 ${result.maxDrawdownPct.toFixed(2)}%`
            );

            const score =
              result.totalReturnPct - alpha * result.maxDrawdownPct;

            if (!bestOnTrain || score > bestOnTrain.score) {
              bestOnTrain = {
                params: { useV2Signal, stopLossPct: sl, takeProfitPct: tp, minAtrPct },
                totalReturnPct: result.totalReturnPct,
                winRate: result.winRate,
                totalTrades: result.totalTrades,
                maxDrawdownPct: result.maxDrawdownPct,
                score,
              };
            }
          }
        }
      }
    }

    if (!bestOnTrain) return console.log("训练集无有效参数");

    console.log("\n=== 训练集最优参数（按 score） ===");
    console.log({
      ...bestOnTrain.params,
      totalReturnPct: bestOnTrain.totalReturnPct.toFixed(2) + "%",
      winRate: bestOnTrain.winRate.toFixed(2) + "%",
      maxDrawdown: bestOnTrain.maxDrawdownPct.toFixed(2) + "%",
      score: bestOnTrain.score.toFixed(2),
    });

    // === 测试集验证 ===
    console.log("\n=== 在测试集上检验最优参数 ===");
    const testResult = backtestSimpleBtcTrend(testCandles, {
      useTrendFilter: true,
      ...bestOnTrain.params,
    });

    printBacktestResult(testResult, testCandles.length);
  } catch (err) {
    console.error("运行出错:", err);
  }
}

main();
