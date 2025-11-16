// src/risk/cooldown.ts
import fs from "node:fs";

const LOG_PATH = "/root/btc-quant-lab/signal-log.jsonl";

// 读取最近 N 条 signal-log 的交易结果
export function checkCooldown(
  maxConsecutiveLoss: number,
  cooldownBars: number
): { inCooldown: boolean; remainingBars: number } {
  if (!fs.existsSync(LOG_PATH)) {
    return { inCooldown: false, remainingBars: 0 };
  }

  const lines = fs.readFileSync(LOG_PATH, "utf-8").trim().split("\n");
  if (lines.length === 0) return { inCooldown: false, remainingBars: 0 };

  let lossStreak = 0;
  let lastLossIndex = -1;

  // 从最后一行开始向上找
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const line = lines[i];
      if (typeof line !== "string") continue;
      const obj = JSON.parse(line);

      if (typeof obj.pnlPct === "number") {
        if (obj.pnlPct < 0) {
          lossStreak++;
          if (lastLossIndex === -1) lastLossIndex = obj.barIndex ?? i;
        } else {
          break; // 遇到盈利，停止搜索
        }
      }
    } catch {}
  }

  // 连续亏损未达到阈值 → 无 cooldown
  if (lossStreak < maxConsecutiveLoss) {
    return { inCooldown: false, remainingBars: 0 };
  }

  const nowBar = lines.length; // 你也可以改成 candle index
  const barsPassed = nowBar - lastLossIndex;
  const remaining = Math.max(0, cooldownBars - barsPassed);

  if (remaining > 0) {
    return { inCooldown: true, remainingBars: remaining };
  }

  return { inCooldown: false, remainingBars: 0 };
}