import "dotenv/config";
import {
  htxPerpGetBalance,
  htxPerpPlaceOrder,
  htxPerpPlaceTpslOrder,
  htxPerpGetUnifiedPositions,   // ✅ 新增这个 import
} from "../exchange/htx-perp.js";
import { fetchBtc4hCandles } from "../exchange/htx.js";

// 等待统一账户下，某个合约的持仓真正建立
async function waitPosition(
  contractCode: string,
  direction: "buy" | "sell",
  maxTries = 15,
  intervalMs = 2000
) {
  for (let i = 0; i < maxTries; i++) {
    const positions = await htxPerpGetUnifiedPositions({ contract_code: contractCode });

    const pos = positions.find(
      (p) =>
        p.contract_code === contractCode &&
        p.direction === direction &&
        Number(p.volume) > 0
    );

    if (pos) {
      console.log(
        `找到仓位: contract=${pos.contract_code}, direction=${pos.direction}, volume=${pos.volume}`
      );
      return pos;
    }

    console.log(
      `第 ${i + 1}/${maxTries} 次轮询仓位，尚未打开，${intervalMs}ms 后重试...`
    );

    await new Promise((r) => setTimeout(r, intervalMs));
  }

  throw new Error("等待仓位超时");
}

async function main() {
  const contractCode = "BTC-USDT";
  const volume = 1;
  const leverage = 5;

  console.log("查询永续统一账户 USDT 余额...");
  const balance = await htxPerpGetBalance("USDT");
  console.log(balance);

  const candles = await fetchBtc4hCandles(1);
  if (!candles || candles.length === 0) {
    throw new Error("未获取到4h K线数据");
  }
  const price = candles[candles.length - 1]?.close;
  if (typeof price !== "number") {
    throw new Error("K线数据格式异常，缺少价格");
  }

  const tp = price * 1.02;
  const sl = price * 0.98;


  console.log(`当前价格: ${price}, TP=${tp}, SL=${sl}`);

  // 1️⃣ 开多
  console.log("\n开多...");
  const openRes = await htxPerpPlaceOrder({
    contract_code: contractCode,
    volume,
    direction: "buy",
    offset: "open",
    lever_rate: leverage,
    order_price_type: "opponent",
  });

  console.log("开多返回:", openRes);

  // 2️⃣ 等待仓位开好
  console.log("\n等待仓位实际打开...");
  const pos = await waitPosition(contractCode, "buy");

  console.log("确认持仓:", pos);

  // 3️⃣ 挂 TPSL
  console.log("\n挂 TPSL 止盈止损订单...");

  const tpslRes = await htxPerpPlaceTpslOrder({
    contract_code: contractCode,
    direction: "sell", // 平多
    volume: Number(pos.volume),
    tp_trigger_price: tp,
    tp_order_price: tp,
    tp_order_price_type: "limit",
    sl_trigger_price: sl,
    sl_order_price: sl,
    sl_order_price_type: "limit",
  });

  console.log("TPSL 返回:", tpslRes);
  console.log("\n✅ 完成。请在 HTX 永续界面检查止盈/止损委托。");
}

main().catch((err) => {
  console.error("永续 TPSL 示例运行出错:", err);
  process.exit(1);
});