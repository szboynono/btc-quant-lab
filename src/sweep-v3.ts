// src/sweep-v3.ts
import "dotenv/config";
import fs from "node:fs";
import type { Candle } from "./types/candle.js";
import { runBacktestWithConfig, type StrategyConfig } from "./backtest-regime.js";
import type { BacktestResult } from "./backtest/engine.js";

interface SweepItem {
  cfg: StrategyConfig;
  stats: BacktestResult;
  score: number;
}

function loadCandlesFromFile(path: string): Candle[] {
  const raw = fs.readFileSync(path, "utf8");
  const data = JSON.parse(raw);
  return data as Candle[];
}

async function main() {
  console.log("===== V3 参数扫街（sweep，本地 data/ JSON）开始 =====");

  // ✅ 直接用你现有的快照
  const candles4h = loadCandlesFromFile("./data/btc-4h.json");
  const candles1d = loadCandlesFromFile("./data/btc-1d.json");

  console.log(`本地 4H K 线数量: ${candles4h.length}`);
  console.log(`本地 1D K 线数量: ${candles1d.length}`);

  if (candles4h.length < 200 || candles1d.length < 200) {
    console.log("K线长度不足，无法回测。");
    return;
  }

  // ===== 参数搜索空间（以后可以再调细） =====
  const stopLossList = [0.006, 0.008, 0.01];             // 0.6% / 0.8% / 1%
  const takeProfitList = [0.04, 0.05, 0.06];             // 4% / 5% / 6%
  const minAtrPctList = [0.007, 0.0075, 0.008, 0.009];   // ATR / price
  const maxRsiList = [65, 70, 75];
  const minRsiList = [25, 30, 35];

  const results: SweepItem[] = [];

  let totalCombos = 0;
  for (const sl of stopLossList) {
    for (const tp of takeProfitList) {
      for (const atrPct of minAtrPctList) {
        for (const maxRsi of maxRsiList) {
          for (const minRsi of minRsiList) {
            if (minRsi >= maxRsi) continue;
            totalCombos++;
          }
        }
      }
    }
  }
  console.log(`本次总共要测试的参数组合数: ${totalCombos}`);

  let idx = 0;

  for (const stopLossPct of stopLossList) {
    for (const takeProfitPct of takeProfitList) {
      for (const minAtrPct of minAtrPctList) {
        for (const maxRsiForEntry of maxRsiList) {
          for (const minRsiForEntry of minRsiList) {
            if (minRsiForEntry >= maxRsiForEntry) continue;

            idx++;
            const cfg: StrategyConfig = {
              useTrendFilter: true,
              useV2Signal: false,
              useV3Signal: true, // ✅ 固定用 V3 宽松确认
              stopLossPct,
              takeProfitPct,
              minAtrPct,
              maxRsiForEntry,
              minRsiForEntry,
            };

            console.log(
              `\n[${idx}/${totalCombos}] 回测组合:`,
              JSON.stringify(cfg)
            );

            const ret = runBacktestWithConfig(candles4h, candles1d, cfg);
            if (!ret || !ret.result) {
              console.log("  -> 回测失败(可能是数据问题)，跳过。");
              continue;
            }

            const stats = ret.result;

            // 简单打分：年化 - 最大回撤
            const score = stats.annualizedReturnPct - stats.maxDrawdownPct;

            if (stats.totalTrades < 8) {
              console.log(
                `  -> 交易笔数太少 (${stats.totalTrades})，先丢弃。`
              );
              continue;
            }

            results.push({ cfg, stats, score });

            console.log(
              `  -> 年化: ${stats.annualizedReturnPct.toFixed(
                2
              )}%, MaxDD: ${stats.maxDrawdownPct.toFixed(
                2
              )}%, Score=${score.toFixed(2)}, Trades=${
                stats.totalTrades
              }, WinRate=${stats.winRate.toFixed(1)}%`
            );
          }
        }
      }
    }
  }

  if (results.length === 0) {
    console.log("\n⚠️ 所有组合都被过滤掉了，没有可用结果。");
    return;
  }

  results.sort((a, b) => b.score - a.score);

  const TOP_N = 15;
  console.log(`\n===== 参数扫街完成，TOP ${TOP_N} 组合 =====`);

  results.slice(0, TOP_N).forEach((item, i) => {
    const { cfg, stats, score } = item;
    console.log(`\n#${i + 1}  Score=${score.toFixed(2)}`);
    console.log(
      `配置: SL=${(cfg.stopLossPct! * 100).toFixed(2)}%, ` +
        `TP=${(cfg.takeProfitPct! * 100).toFixed(2)}%, ` +
        `minAtrPct=${(cfg.minAtrPct! * 100).toFixed(2)}%, ` +
        `RSI区间=[${cfg.minRsiForEntry}, ${cfg.maxRsiForEntry}]`
    );
    console.log(
      `结果: 年化=${stats.annualizedReturnPct.toFixed(
        2
      )}%, MaxDD=${stats.maxDrawdownPct.toFixed(
        2
      )}%, 总收益=${stats.totalReturnPct.toFixed(
        2
      )}%, 笔数=${stats.totalTrades}, 胜率=${stats.winRate.toFixed(2)}%`
    );
  });

  console.log("\n✅ sweep-v3 结束。可以从前几名里挑一个写回 strategy.json。");
}

main().catch((err) => {
  console.error("sweep-v3 运行出错:", err);
  process.exit(1);
});