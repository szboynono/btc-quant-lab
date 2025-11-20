// src/examples/htx-list-accounts.ts
import "dotenv/config";
import { htxGetAccounts } from "../exchange/htx-private.js";

async function main() {
  try {
    const res = await htxGetAccounts();
    console.log("HTX 账户列表返回：");
    console.dir(res, { depth: null });
  } catch (err) {
    console.error("调用失败:", err);
  }
}

main().catch((err) => {
  console.error("运行出错:", err);
  process.exit(1);
});