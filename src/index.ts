// src/index.ts
import { fetchBtc4hCandles } from "./exchange/binance.js";
import {
  backtestBtcMeanRevert,
  printBacktestResultMR,
} from "./backtest/mean-revert-engine.js";

async function main() {
  try {
    console.log("正在从Binance获取BTCUSDT 4小时K线...");
    const candles = await fetchBtc4hCandles(3000);
    console.log(`获取到 ${candles.length} 根K线。开始均值回归策略参数扫描...\n`);

    // 简单参数网格：
    const slList = [0.01, 0.015];          // 1%, 1.5%
    const tpList = [0.02, 0.03];           // 2%, 3%
    const bandEnterList = [1.5, 2.0, 2.5]; // 入场带宽：1.5~2.5 * ATR
    const bandExitList = [0.3, 0.5, 0.8];  // 出场带宽：0.3~0.8 * ATR
    const atrThreshList = [0.003, 0.005];  // 0.3%, 0.5% 波动

    let best: {
      totalReturnPct: number;
      params: {
        stopLossPct: number;
        takeProfitPct: number;
        bandKEnter: number;
        bandKExit: number;
        minAtrPct: number;
      };
    } | null = null;

    for (const minAtrPct of atrThreshList) {
      console.log(
        `\n=== minAtrPct = ${(minAtrPct * 100).toFixed(2)}% ===`
      );

      for (const bandKEnter of bandEnterList) {
        for (const bandKExit of bandExitList) {
          if (bandKExit >= bandKEnter) continue; // 出场带宽必须比入场小

          for (const sl of slList) {
            for (const tp of tpList) {
              const result = backtestBtcMeanRevert(candles, {
                stopLossPct: sl,
                takeProfitPct: tp,
                bandKEnter,
                bandKExit,
                minAtrPct,
              });

              if (!result) continue;

              console.log(
                `bandEnter=${bandKEnter}  bandExit=${bandKExit}  SL=${(
                  sl * 100
                ).toFixed(1)}%  TP=${(tp * 100).toFixed(
                  1
                )}% -> 总收益 ${result.totalReturnPct.toFixed(
                  2
                )}% | 胜率 ${result.winRate.toFixed(
                  2
                )}% | 笔数 ${result.totalTrades}`
              );

              if (
                !best ||
                result.totalReturnPct > best.totalReturnPct
              ) {
                best = {
                  totalReturnPct: result.totalReturnPct,
                  params: {
                    stopLossPct: sl,
                    takeProfitPct: tp,
                    bandKEnter,
                    bandKExit,
                    minAtrPct,
                  },
                };
              }
            }
          }
        }
      }
    }

    if (!best) {
      console.log("没有找到任何有效参数组合。");
      return;
    }

    console.log("\n=== 最优参数组合（在整段 3000 根上） ===");
    console.log({
      totalReturnPct: best.totalReturnPct.toFixed(2) + "%",
      SL: best.params.stopLossPct,
      TP: best.params.takeProfitPct,
      bandKEnter: best.params.bandKEnter,
      bandKExit: best.params.bandKExit,
      minAtrPct: best.params.minAtrPct,
    });

    // 用最优参数打印详细结果
    const finalResult = backtestBtcMeanRevert(candles, best.params);
    if (finalResult) {
      console.log("\n=== 最优参数详细回测结果 ===");
      printBacktestResultMR(finalResult, candles.length);
    }
  } catch (err) {
    console.error("运行出错:", err);
  }
}

main();
