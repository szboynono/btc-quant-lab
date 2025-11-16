import { fetchBtc4hCandles } from "./exchange/binance.js";
import { backtestSimpleBtcTrend } from "./backtest/engine.js";

type BestResult = {
  windowIndex: number;
  windowStartIdx: number;
  windowEndIdx: number;
  params: {
    useV2Signal: boolean;
    stopLossPct: number;
    takeProfitPct: number;
    minAtrPct: number;
  };
  train: {
    totalReturnPct: number;
    winRate: number;
    totalTrades: number;
    maxDrawdownPct: number;
    score: number;
  };
  test: {
    totalReturnPct: number;
    winRate: number;
    totalTrades: number;
    maxDrawdownPct: number;
    annualizedReturnPct: number;
  };
};

async function main() {
  console.log("正在从Binance获取BTCUSDT 4小时K线...");
  const candles = await fetchBtc4hCandles(3000);
  console.log(`获取到 ${candles.length} 根K线。`);

  const windowCount = 3;                       // 3 个时间窗口
  const windowSize = Math.floor(candles.length / windowCount);

  const slList = [0.015, 0.02];
  const tpList = [0.04, 0.05];
  const signalVersions = [false, true];        // false=v1, true=v2
  const atrThreshList = [0.005, 0.01, 0.015];  // 0.5%, 1%, 1.5%
  const alpha = 0.5;                           // 回撤惩罚权重

  const windowResults: BestResult[] = [];

  for (let w = 0; w < windowCount; w++) {
    const startIdx = w * windowSize;
    const endIdx =
      w === windowCount - 1 ? candles.length : (w + 1) * windowSize;
    const windowCandles = candles.slice(startIdx, endIdx);
    const windowLen = windowCandles.length;

    if (windowLen < 210) {
      console.log(`窗口 ${w} 数据太少，跳过`);
      continue;
    }

    const splitIndex = Math.floor(windowLen * 0.67);
    const trainCandles = windowCandles.slice(0, splitIndex);
    const testCandles = windowCandles.slice(splitIndex);

    console.log(
      `\n==============================\n` +
        `窗口 ${w} [${startIdx} ~ ${endIdx})  共 ${windowLen} 根K\n` +
        `训练集: ${trainCandles.length}  测试集: ${testCandles.length}\n` +
        `==============================`
    );

    let bestOnTrain: any = null;

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
              )}% -> ` +
                `Train 总收益 ${result.totalReturnPct.toFixed(
                  2
                )}% | 胜率 ${result.winRate.toFixed(
                  2
                )}% | 笔数 ${result.totalTrades} | 回撤 ${result.maxDrawdownPct.toFixed(
                  2
                )}%`
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

    if (!bestOnTrain) {
      console.log(`窗口 ${w}：训练集无有效结果，跳过`);
      continue;
    }

    console.log("\n>>> 窗口最优参数（按 score）");
    console.log({
      window: w,
      ...bestOnTrain.params,
      totalReturnPct: bestOnTrain.totalReturnPct.toFixed(2) + "%",
      winRate: bestOnTrain.winRate.toFixed(2) + "%",
      maxDrawdown: bestOnTrain.maxDrawdownPct.toFixed(2) + "%",
      score: bestOnTrain.score.toFixed(2),
    });

    const testResult = backtestSimpleBtcTrend(testCandles, {
      useTrendFilter: true,
      ...bestOnTrain.params,
    });

    if (!testResult) {
      console.log(`窗口 ${w}：测试集回测失败`);
      continue;
    }

    console.log("\n>>> 测试集表现");
    console.log({
      totalReturnPct: testResult.totalReturnPct.toFixed(2) + "%",
      winRate: testResult.winRate.toFixed(2) + "%",
      trades: testResult.totalTrades,
      maxDrawdown: testResult.maxDrawdownPct.toFixed(2) + "%",
      annualizedReturn: testResult.annualizedReturnPct.toFixed(2) + "%",
    });

    windowResults.push({
      windowIndex: w,
      windowStartIdx: startIdx,
      windowEndIdx: endIdx,
      params: bestOnTrain.params,
      train: {
        totalReturnPct: bestOnTrain.totalReturnPct,
        winRate: bestOnTrain.winRate,
        totalTrades: bestOnTrain.totalTrades,
        maxDrawdownPct: bestOnTrain.maxDrawdownPct,
        score: bestOnTrain.score,
      },
      test: {
        totalReturnPct: testResult.totalReturnPct,
        winRate: testResult.winRate,
        totalTrades: testResult.totalTrades,
        maxDrawdownPct: testResult.maxDrawdownPct,
        annualizedReturnPct: testResult.annualizedReturnPct,
      },
    });
  }

  console.log("\n==============================");
  console.log("多窗口总结：");
  console.dir(
    windowResults.map((r) => ({
      window: r.windowIndex,
      params: {
        useV2: r.params.useV2Signal,
        SL: r.params.stopLossPct,
        TP: r.params.takeProfitPct,
        minAtrPct: r.params.minAtrPct,
      },
      train: {
        totalReturnPct: r.train.totalReturnPct.toFixed(2) + "%",
        dd: r.train.maxDrawdownPct.toFixed(2) + "%",
        score: r.train.score.toFixed(2),
      },
      test: {
        totalReturnPct: r.test.totalReturnPct.toFixed(2) + "%",
        dd: r.test.maxDrawdownPct.toFixed(2) + "%",
        ann: r.test.annualizedReturnPct.toFixed(2) + "%",
        trades: r.test.totalTrades,
      },
    })),
    { depth: null }
  );
}

main().catch((e) => console.error("运行出错:", e));
