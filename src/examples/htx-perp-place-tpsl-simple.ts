// src/examples/htx-perp-place-tpsl-simple.ts
import "dotenv/config";
import {
  htxPerpGetBalance,
  htxPerpPlaceOrder,
  htxPerpPlaceTpslOrderSimple,
  htxPerpGetPositions,
  type HtxPosition,
} from "../exchange/htx-perp.js";
import { fetchBtc4hCandles } from "../exchange/htx.js";

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitPosition(params: {
  contract_code: string;
  direction: "buy" | "sell";
  minVolume: number;
  maxTries?: number;
  intervalMs?: number;
}): Promise<HtxPosition> {
  const { contract_code, direction, minVolume } = params;
  const maxTries = params.maxTries ?? 15;
  const intervalMs = params.intervalMs ?? 1000;

  for (let i = 0; i < maxTries; i++) {
    const resp = await htxPerpGetPositions(contract_code);
    const list = resp.data ?? [];

    const pos = list.find(
      (p) =>
        p.contract_code === contract_code &&
        p.direction === direction &&
        Number(p.avail_position ?? p.volume ?? 0) >= minVolume
    );

    if (pos) {
      return pos;
    }

    await sleep(intervalMs);
  }

  throw new Error("等待仓位超时");
}

async function main() {
  console.log("查询永续统一账户余额...");
  const balance = await htxPerpGetBalance("USDT");
  console.log("永续统一账户 USDT:", balance);

  console.log("获取 BTCUSDT 现价(用 4H 最新收盘价近似)...");
  const candles = await fetchBtc4hCandles(5);
  const last = candles[candles.length - 1]!;
  const price = last.close;
  console.log(`当前 4H 收盘价: ${price}`);

  const stopLossPct = 0.008; // 0.8%
  const takeProfitPct = 0.05; // 5%
  const tpPrice = price * (1 + takeProfitPct);
  const slPrice = price * (1 - stopLossPct);

  console.log(
    `准备测试 BTC 永续多单 + TPSL: 现价=${price.toFixed(
      2
    )}, TP=${tpPrice.toFixed(2)}, SL=${slPrice.toFixed(2)}`
  );

  const contractCode = "BTC-USDT";
  const volume = 1; // 测试 1 张
  const leverRate = 5;

  console.log("\n=== 先开多 ===");
  const openRes = await htxPerpPlaceOrder({
    contract_code: contractCode,
    volume,
    direction: "buy", // 开多
    offset: "open",
    lever_rate: leverRate,
    order_price_type: "opponent",
  });

  console.log("开多返回:", openRes);

  console.log("\n等待仓位实际打开...");
  const pos = await waitPosition({
    contract_code: contractCode,
    direction: "buy",
    minVolume: volume,
  });

  console.log("检测到持仓:", pos);

  function normalizePrice(p: number) {
    return Number(p.toFixed(2)); // BTC 永续要求 0.01
  }

  console.log("\n现在用 position_id + 持仓数量，挂 TP + SL TPSL 触发单");

  const tp = normalizePrice(tpPrice);
  const sl = normalizePrice(slPrice);

  console.log(`挂 TPSL: TP=${tp}, SL=${sl}`);

  const tpslRes = await htxPerpPlaceTpslOrderSimple({
    contract_code: contractCode,
    volume: Number(pos.available ?? pos.avail_position ?? pos.volume ?? volume),
    direction: "sell",
    tp_trigger_price: tp,
    sl_trigger_price: sl,
    position_id: pos.position_id,
  });

  console.log("\nTPSL 下单返回:", tpslRes);

  console.log(
    "\n✅ 如果这里 status=ok，就说明：开仓 + 持仓查询 + TPSL 全链路已经打通。"
  );
}

main().catch((err) => {
  console.error("永续 TPSL 简单示例运行出错:", err);
  process.exit(1);
});
