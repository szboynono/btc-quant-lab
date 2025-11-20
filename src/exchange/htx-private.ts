// src/exchange/htx-private.ts
import "dotenv/config";
import { createHmac } from "crypto";

const HTX_API_HOST = process.env.HTX_API_HOST ?? "api.huobi.pro";
const HTX_API_SCHEME = "https";
const HTX_BASE_URL = `${HTX_API_SCHEME}://${HTX_API_HOST}`;

const HTX_ACCESS_KEY = process.env.HTX_ACCESS_KEY;
const HTX_SECRET_KEY = process.env.HTX_SECRET_KEY;

if (!HTX_ACCESS_KEY || !HTX_SECRET_KEY) {
  console.warn(
    "[HTX] 警告：HTX_ACCESS_KEY 或 HTX_SECRET_KEY 未配置，将无法调用私有接口。"
  );
}

type HttpMethod = "GET" | "POST";

interface PrivateRequestOptions {
  method: HttpMethod;
  path: string; // 例如 "/v1/account/accounts"
  params?: Record<string, string | number | boolean | undefined>;
  body?: any; // POST 时发送的 JSON
}

/**
 * HTX 签名要求的 UTC 时间戳，格式：YYYY-MM-DDThh:mm:ss
 * 注意：不带毫秒和 Z
 */
function getUtcTimestamp(): string {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}`;
}

/**
 * 把参数按 key ASCII 排序并 URI 编码
 */
function buildCanonicalQuery(params: Record<string, string>): string {
  const keys = Object.keys(params).sort();
  return keys
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k]!)}`)
    .join("&");
}

/**
 * 生成签名并返回完整 URL（带 ? + 签名后的 query）
 */
function buildSignedUrl(
  method: HttpMethod,
  path: string,
  userParams: Record<string, string | number | boolean | undefined> = {}
): string {
  if (!HTX_ACCESS_KEY || !HTX_SECRET_KEY) {
    throw new Error(
      "[HTX] 缺少 HTX_ACCESS_KEY / HTX_SECRET_KEY 环境变量，无法签名请求。"
    );
  }

  // 1) 基础认证参数
  const authParams: Record<string, string> = {
    AccessKeyId: HTX_ACCESS_KEY,
    SignatureMethod: "HmacSHA256",
    SignatureVersion: "2",
    Timestamp: getUtcTimestamp(),
  };

  // 2) 合并用户参数（转成字符串）
  const allParams: Record<string, string> = { ...authParams };
  for (const [k, v] of Object.entries(userParams)) {
    if (v === undefined) continue;
    allParams[k] = String(v);
  }

  // 3) 生成排序后的 query
  const canonicalQuery = buildCanonicalQuery(allParams);

  // 4) 构造待签名字符串
  const payload = [
    method.toUpperCase(),
    HTX_API_HOST,
    path,
    canonicalQuery,
  ].join("\n");

  // 5) HMAC-SHA256 + base64
  const signature = createHmac("sha256", HTX_SECRET_KEY)
    .update(payload)
    .digest("base64");

  const signedQuery =
    canonicalQuery + `&Signature=${encodeURIComponent(signature)}`;

  return `${HTX_BASE_URL}${path}?${signedQuery}`;
}

/**
 * 通用私有请求封装
 */
export async function htxPrivateRequest<T = any>(
  opts: PrivateRequestOptions
): Promise<T> {
  const { method, path, params, body } = opts;

  const url = buildSignedUrl(method, path, params);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  const init: RequestInit = {
    method,
    headers,
  };

  if (method === "POST" && body !== undefined) {
    init.body = JSON.stringify(body);
  }

  const res = await fetch(url, init);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `[HTX] HTTP 请求失败: ${res.status} ${res.statusText} ${text}`
    );
  }

  const data = (await res.json().catch((e) => {
    throw new Error(`[HTX] 返回非 JSON：${String(e)}`);
  })) as any;

  // 大部分接口都有 status 字段
  if (data && data.status && data.status !== "ok") {
    throw new Error(
      `[HTX] API 返回错误: status=${data.status}, err-code=${data["err-code"]}, err-msg=${data["err-msg"]}`
    );
  }

  return data as T;
}

/**
 * 获取现货账户列表：GET /v1/account/accounts
 */
export async function htxGetAccounts(): Promise<any> {
  return htxPrivateRequest({
    method: "GET",
    path: "/v1/account/accounts",
  });
}

/**
 * 下现货订单：POST /v1/order/orders/place
 * 这里封一层最常用参数，其余可以自己扩展。
 */
export type SpotOrderType =
  | "buy-market"
  | "sell-market"
  | "buy-limit"
  | "sell-limit";

export interface CreateSpotOrderParams {
  symbol: string;              // 例： "btcusdt"
  type: SpotOrderType;         // 例： "buy-limit"
  amount: string;              // 数量（买入市价单时是金额）
  price?: string;              // 限价单需要
  clientOrderId?: string;      // 可选，自定义ID
  source?: string;             // 默认 "spot-api"
  accountId?: string;          // 不传则用环境变量 HTX_ACCOUNT_ID
}

export async function htxCreateSpotOrder(
  params: CreateSpotOrderParams
): Promise<string> {
  const accountIdEnv = process.env.HTX_ACCOUNT_ID;
  const accountId = params.accountId ?? accountIdEnv;

  if (!accountId) {
    throw new Error(
      "[HTX] 创建订单失败：没有提供 accountId，且 HTX_ACCOUNT_ID 未配置。"
    );
  }

  const body: Record<string, any> = {
    "account-id": accountId,
    symbol: params.symbol,
    type: params.type,
    amount: params.amount,
    source: params.source ?? "spot-api",
  };

  if (params.price) {
    body.price = params.price;
  }
  if (params.clientOrderId) {
    body["client-order-id"] = params.clientOrderId;
  }

  const res = await htxPrivateRequest<{
    status: string;
    data: string; // order-id
  }>({
    method: "POST",
    path: "/v1/order/orders/place",
    body,
  });

  // res.data 就是 order-id
  return (res as any).data;
}