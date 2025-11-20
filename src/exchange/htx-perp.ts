// src/exchange/htx-perp.ts
import crypto from "crypto";
import "dotenv/config";

const HTX_PERP_HOST = process.env.HTX_PERP_HOST ?? "api.hbdm.com";
const HTX_PERP_BASE_URL = `https://${HTX_PERP_HOST}`;

const ACCESS_KEY = process.env.HTX_ACCESS_KEY ?? "";
const SECRET_KEY = process.env.HTX_SECRET_KEY ?? "";

// ✅ HTX 要求的时间格式：UTC, ISO8601, 无毫秒，例如 2025-11-19T13:20:30
function toHtxTimestamp(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "");
}

// 把参数按字典序编码成 query string
function buildQuery(params: Record<string, string>): string {
  return Object.keys(params)
    .sort()
    .map(
      (key) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(params[key] ?? "")}`
    )
    .join("&");
}

// 计算签名
function signRequest(
  method: "GET" | "POST",
  host: string,
  path: string,
  params: Record<string, string>
): string {
  const query = buildQuery(params);
  const payload = [method.toUpperCase(), host, path, query].join("\n");
  return crypto
    .createHmac("sha256", SECRET_KEY)
    .update(payload)
    .digest("base64");
}

// ✅ 永续合约专用的私有请求
export async function htxPerpPrivateRequest<T>(
  method: "GET" | "POST",
  path: string,
  extraParams: Record<string, string | number> = {},
  body?: any
): Promise<T> {
  if (!ACCESS_KEY || !SECRET_KEY) {
    throw new Error("请先在 .env 里配置 HTX_ACCESS_KEY / HTX_SECRET_KEY");
  }

  // ✅ 关键：用 HTX 需要的 Timestamp 格式
  const timestamp = toHtxTimestamp(new Date());

  // 基础认证参数
  const authParams: Record<string, string> = {
    AccessKeyId: ACCESS_KEY,
    SignatureMethod: "HmacSHA256",
    SignatureVersion: "2",
    Timestamp: timestamp,
  };

  // 业务参数（全部转成字符串）
  const bizParams: Record<string, string> = {};
  for (const [k, v] of Object.entries(extraParams)) {
    if (v === undefined || v === null) continue;
    bizParams[k] = String(v);
  }

  const params: Record<string, string> = {
    ...authParams,
    ...bizParams,
  };

  const signature = signRequest(method, HTX_PERP_HOST, path, params);
  const query = buildQuery(params);
  const url =
    `${HTX_PERP_BASE_URL}${path}?${query}` +
    `&Signature=${encodeURIComponent(signature)}`;

  const fetchOptions: RequestInit = {
    method,
    headers: {
      "Content-Type": "application/json",
    },
  };

  if (method === "POST" && body) {
    fetchOptions.body = JSON.stringify(body);
  }

  const res = await fetch(url, fetchOptions);
  const raw = await res.text();

  let json: any;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(
      `[HTX PERP ERROR] HTTP ${res.status} - 无法解析响应: ${raw.slice(
        0,
        200
      )}`
    );
  }

  // 永续这边有时是 { status: "ok", data: ... }，有时是 { code:200, data:... }
  if (json.status !== "ok" && json.code !== 200) {
    throw new Error(
      `[HTX PERP ERROR] ${json.err_code ?? json.code} - ${
        json.err_msg ?? json.message
      } | raw=${raw}`
    );
  }

  return json as T;
}

// ============ 公共方法 ============

// unified_account_info 返回结构（简化版）
type HtxUnifiedSwapAccount = {
  margin_asset: string;          // "USDT"
  margin_balance: number;        // 总权益
  margin_static: number;
  cross_margin_static: number;
  cross_profit_unreal: number;
  margin_frozen: number;
  withdraw_available: number;
  cross_risk_rate: number | null;
  cross_swap: any[];
  cross_future: any[];
  isolated_swap: {
    symbol: string;
    contract_code: string;
    margin_mode: "isolated" | "cross";
    withdraw_available: number;
    margin_available: number;
    lever_rate: number;
  }[];
};

export async function htxPerpGetBalance(asset: string = "USDT") {
  const resp = await htxPerpPrivateRequest<{
    status: string;
    data: HtxUnifiedSwapAccount[];
    ts: number;
  }>("GET", "/linear-swap-api/v3/unified_account_info", {});

  if (process.env.DEBUG) {
    console.log(
      "[DEBUG] unified_account_info 原始响应:",
      JSON.stringify(resp, null, 2)
    );
  }

  const list = resp.data ?? [];
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error(
      `未从 unified_account_info 返回任何账户数据。原始响应: ${JSON.stringify(resp).slice(
        0,
        500
      )}`
    );
  }

  // 找到 USDT 账户
  const acc = list.find((a) => a.margin_asset === asset);
  if (!acc) {
    throw new Error(
      `无法找到保证金资产 ${asset} 的账户信息。可用资产: ${list
        .map((a) => a.margin_asset)
        .join(", ")}`
    );
  }

  const total = Number(acc.margin_balance ?? 0);
  const available = Number(acc.withdraw_available ?? acc.margin_balance ?? 0);

  return {
    raw: resp,
    asset: acc.margin_asset,
    total,
    available,
  };
}

// ✅ 逐仓 U 本位永续下单：/linear-swap-api/v1/swap_order
// 注意：volume 是 “合约张数（整数）”，不是 BTC 数量
export async function htxPerpPlaceOrder(params: {
  contract_code: string; // 如 "BTC-USDT"
  volume: number;        // 合约张数（必须是整数 >= 1）
  direction: "buy" | "sell";
  offset?: "open" | "close" | "both"; // 单向持仓可以不填或用 "both"
  lever_rate: number;
  order_price_type: string; // "opponent" / "limit" / "optimal_5" 等
  price?: number;
}) {
  const path = "/linear-swap-api/v1/swap_order";

  // ✅ 强制 volume 为整数张数
  const volInt = Math.floor(params.volume);
  if (!Number.isFinite(volInt) || volInt <= 0) {
    throw new Error(
      `无效的 volume=${params.volume}，必须是 >= 1 的整数（合约张数，不是 BTC 数量）`
    );
  }

  const bodyParams: Record<string, string | number> = {
    contract_code: params.contract_code,
    direction: params.direction,
    lever_rate: params.lever_rate,
    volume: volInt,
    order_price_type: params.order_price_type,
  };

  // 单向持仓时 offset 可选，双向模式下必填
  if (params.offset) {
    bodyParams.offset = params.offset;
  }

  if (params.price !== undefined) {
    bodyParams.price = params.price;
  }

  return await htxPerpPrivateRequest("POST", path, {}, bodyParams);
}