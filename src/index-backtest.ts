import path from "node:path";
import { readFile } from "node:fs/promises";
import {
  backtestSimpleBtcTrend,
  printBacktestResult,
} from "./backtest/engine.js";
import type { Trade } from "./types/candle.js";
import { fetchBtc4hCandles, fetchBtc1dCandles } from "./exchange/binance.js";

// === 配置类型定义 ===

interface TrendConfig {
  useTrendFilter: boolean;
  useV2Signal: boolean;
  stopLossPct: number;
  takeProfitPct: number;
  minAtrPct: number;
}

interface RiskConfig {
  initialCapital: number;   // 初始资金（USDT）
  leverageList: number[];   // 需要模拟的杠杆列表，比如 [3,5]
}

interface AppConfig {
  candlesLimit?: number;    // 拉多少根 K 线，不填就默认 3000
  trend: TrendConfig;
  risk: RiskConfig;
}

// === 从 JSON 读取配置 ===

async function loadConfig(configPath = "./config.json"): Promise<AppConfig> {
  const absPath = path.resolve(configPath);
  const raw = await readFile(absPath, "utf-8");
  const parsed = JSON.parse(raw);

  // 这里简单做一点点兜底，防止配置写漏
  if (!parsed.trend || !parsed.risk) {
    throw new Error("config.json 缺少 trend 或 risk 配置");
  }

  return parsed as AppConfig;
}

// === 杠杆资金曲线模拟（基于回测出来的每笔 pnlPct）===

type LeveragedEquityResult = {
  leverage: number;
  initialCapital: number;
  finalCapital: number;
  totalReturnPct: number;
  maxDrawdownPct: number;
  maxLosingStreak: number;
  annualizedReturnPct: number;
};

function simulateLeveragedEquity(
  trades: Trade[],
  leverage: number,
  initialCapital: number
): LeveragedEquityResult {
  let equity = initialCapital;
  let peak = initialCapital;
  let maxDrawdownPct = 0;

  let maxLosingStreak = 0;
  let losingStreak = 0;

  for (const t of trades) {
    // 把原本每笔的 pnlPct 按杠杆线性放大
    const pctChange = (t.pnlPct * leverage) / 100;
    equity *= 1 + pctChange;

    if (t.pnlPct < 0) {
      losingStreak += 1;
    } else {
      losingStreak = 0;
    }
    if (losingStreak > maxLosingStreak) {
      maxLosingStreak = losingStreak;
    }

    if (equity > peak) {
      peak = equity;
    }
    const dd = ((peak - equity) / peak) * 100;
    if (dd > maxDrawdownPct) {
      maxDrawdownPct = dd;
    }
  }

  const finalCapital = equity;
  const totalReturnPct = (finalCapital / initialCapital - 1) * 100;

  // 粗略按“从第一笔进场到最后一笔出场”的年化
  let annualizedReturnPct = 0;
  if (trades.length > 1) {
    const first = trades[0]!;
    const last = trades[trades.length - 1]!;
    const msDiff = last.exitTime - first.entryTime;
    if (msDiff > 0) {
      const years = msDiff / (1000 * 60 * 60 * 24 * 365);
      const growth = finalCapital / initialCapital;
      annualizedReturnPct = (Math.pow(growth, 1 / years) - 1) * 100;
    }
  }

  return {
    leverage,
    initialCapital,
    finalCapital,
    totalReturnPct,
    maxDrawdownPct,
    maxLosingStreak,
    annualizedReturnPct,
  };
}

// === 主流程 ===

async function main() {
  try {
    // 1. 读取配置
    const config = await loadConfig("./config.json");
    const candlesLimit = config.candlesLimit ?? 3000;

    console.log("正在从Binance获取BTCUSDT 4小时K线...");
    const candles = await fetchBtc4hCandles(candlesLimit);
    console.log(`获取到 ${candles.length} 根K线。`);

    // 2. 强趋势突破策略回测（参数来自 JSON）
    console.log("\n=== 强趋势策略（JSON 配置） ===");
    const trendResult = backtestSimpleBtcTrend(candles, {
      useTrendFilter: config.trend.useTrendFilter,
      useV2Signal: config.trend.useV2Signal,
      stopLossPct: config.trend.stopLossPct,
      takeProfitPct: config.trend.takeProfitPct,
      minAtrPct: config.trend.minAtrPct,
    });

    if (!trendResult) {
      console.log("趋势策略回测未生成有效结果。");
      return;
    }

    printBacktestResult(trendResult, candles.length);

    // 3. 基于同一组交易，做多种杠杆资金曲线模拟
    console.log("\n=== 杠杆资金曲线模拟（基于 JSON 配置） ===");
    const { initialCapital, leverageList } = config.risk;
    for (const lev of leverageList) {
      const sim = simulateLeveragedEquity(
        trendResult.trades,
        lev,
        initialCapital
      );

      console.log(`\n=== 杠杆 ${lev}x 模式资金曲线模拟 ===`);
      console.log(
        `初始资金: ${sim.initialCapital.toFixed(2)} USDT`
      );
      console.log(
        `最终资金: ${sim.finalCapital.toFixed(2)} USDT`
      );
      console.log(
        `总收益（资金维度，复利）: ${sim.totalReturnPct.toFixed(2)} %`
      );
      console.log(
        `最大回撤（资金维度）: ${sim.maxDrawdownPct.toFixed(2)} %`
      );
      console.log(
        `最大连续亏损笔数: ${sim.maxLosingStreak}`
      );
      console.log(
        `年化收益（粗略，资金维度）: ${sim.annualizedReturnPct.toFixed(2)} %`
      );
    }

    // 之后如果你要：也可以在这里把弱趋势 / RSI 策略也改成用 JSON 配，就同样套路读取 config.weakRsi
  } catch (err) {
    console.error("运行出错:", err);
  }
}

main();