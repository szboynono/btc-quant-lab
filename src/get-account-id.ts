// get-account-id.ts
import "dotenv/config";
import crypto from "crypto";
import axios from "axios";


const API_KEY = process.env.HTX_ACCESS_KEY!;
const API_SECRET = process.env.HTX_SECRET_KEY!;
const BASE = "https://api.huobi.pro";

console.log(API_KEY, API_SECRET);

function sign(method: string, path: string, params: any) {
  const sorted = Object.keys(params)
    .sort()
    .map((k) => `${k}=${encodeURIComponent(params[k])}`)
    .join("&");

  const meta = `${method}\napi.huobi.pro\n${path}\n${sorted}`;
  const hash = crypto.createHmac("sha256", API_SECRET).update(meta).digest("base64");

  return { sorted, signature: hash };
}

async function getAccounts() {
  const path = "/v1/account/accounts";
  const params = {
    AccessKeyId: API_KEY,
    SignatureMethod: "HmacSHA256",
    SignatureVersion: "2",
    Timestamp: new Date().toISOString().slice(0, 19),
  };

  const { sorted, signature } = sign("GET", path, params);
  const url = `${BASE}${path}?${sorted}&Signature=${encodeURIComponent(signature)}`;

  const res = await axios.get(url);
  console.log("账户列表：", res.data);

  if (res.data.data && res.data.data.length > 0) {
    console.log("\n⭐ 你的 account-id：", res.data.data[0].id);
  }
}

getAccounts().catch(console.error);