// src/examples/htx-perp-place-order.ts
import "dotenv/config";
import { htxPerpGetBalance, htxPerpPlaceOrder } from "../exchange/htx-perp.js";

async function main() {
  console.log("查询永续统一账户 USDT 余额...");
  const bal = await htxPerpGetBalance("USDT");
  console.log(
    `永续统一账户 ${bal.asset} 总权益: ${bal.total}, 可用: ${bal.available}`
  );

  // ⚠️ 这里只是冒烟测试：固定 1 张合约
  // volume = 1 是 “1 张”，不是 1 BTC
  console.log("尝试下一个 1 张的小额测试订单 (BTC-USDT，多单，全仓逐仓)...");

  const res = await htxPerpPlaceOrder({
    contract_code: "BTC-USDT",
    direction: "buy",
    offset: "open",          // 单向持仓也可以不写；你现在写 open 没问题
    lever_rate: 3,
    order_price_type: "opponent", // 对手价
    volume: 1,                     // ✅ 整数张数
    // price: 可选，限价单才需要
  });

  console.log("下单返回:", JSON.stringify(res, null, 2));
}

main().catch((err) => {
  console.error("永续订单失败:", err);
  process.exit(1);
});