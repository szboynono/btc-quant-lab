// src/examples/htx-place-spot-order.ts
import "dotenv/config";
import { htxCreateSpotOrder } from "../exchange/htx-private.js";

async function main() {
  // 这里演示一个很小的 BTCUSDT 限价买单，你自己按 HTX 最小交易量调整
  const symbol = "btcusdt";
  const type = "buy-limit" as const;

  // 示例：买 0.0005 BTC，价格 80000 USDT
  // ⚠️ 一定自己改成你想要的数量和价格
  const amount = "0.0005";
  const price = "80000";

  try {
    const orderId = await htxCreateSpotOrder({
      symbol,
      type,
      amount,
      price,
      clientOrderId: `nono-${Date.now()}`,
    });

    console.log("下单成功，order-id =", orderId);
  } catch (err) {
    console.error("下单失败:", err);
  }
}

main().catch((err) => {
  console.error("运行出错:", err);
  process.exit(1);
});