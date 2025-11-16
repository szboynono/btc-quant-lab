// src/log/signal-log.ts
import { promises as fs } from "fs";
import path from "node:path";

const LOG_FILE = "signal-log.jsonl"; // 会写在你运行 node 的当前目录

export interface SignalLogEntry {
  time: string;          // ISO 字符串
  price: number;
  stopLoss: number;
  takeProfit: number;
  rawSignal: string;
  trendOk: boolean;
  ema50: number;
  ema200: number;
  atrPct: number;

  // 方便你以后看杠杆风险
  leverage3x: {
    slPctOnEquity: number; // -x%
    tpPctOnEquity: number; // +x%
  };
  leverage5x: {
    slPctOnEquity: number;
    tpPctOnEquity: number;
  };

  // 可选：仓位建议（用于 live 运行时记录）
  positionSuggestion?: {
    accountSizeUSDT: number;
    capitalPctPerTrade: number;
    leverage: number;
    capitalToUse: number; // USDT
    notional: number;     // 名义价值（USDT）
    qtyBTC: number;       // 购买数量（BTC）
  };
}

export async function appendSignalLog(entry: SignalLogEntry): Promise<void> {
  const line = JSON.stringify(entry) + "\n";
  const logPath = path.resolve(LOG_FILE);
  
  try {
    await fs.appendFile(logPath, line, "utf8");
    console.log(`✅ 日志已写入: ${logPath}`);
  } catch (err) {
    console.error(`❌ 写入 signal-log 失败 (路径: ${logPath}):`, err);
    throw err; // 重新抛出错误，让调用者知道失败了
  }
}