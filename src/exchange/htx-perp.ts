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

// 公共 GET 请求（不用签名，查合约信息等公共数据）
async function htxPerpPublicGet<T>(
  path: string,
  extraParams: Record<string, string | number> = {}
): Promise<T> {
  const qs = buildQuery(
    Object.fromEntries(
      Object.entries(extraParams).map(([k, v]) => [k, String(v)])
    )
  );
  const url = `${HTX_PERP_BASE_URL}${path}${qs ? "?" + qs : ""}`;

  const res = await fetch(url);
  const raw = await res.text();

  let json: any;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(
      `[HTX PERP PUBLIC ERROR] HTTP ${res.status} - 无法解析响应: ${raw.slice(
        0,
        200
      )}`
    );
  }

  return json as T;
}

// 合约信息类型（只用到 contract_code / price_tick）
type HtxContractInfo = {
  contract_code: string;
  price_tick: string | number;
};

// 获取某个合约的 price_tick（最小价格步长）
async function getPriceTick(contract_code: string): Promise<number> {
  const resp = await htxPerpPublicGet<{
    status: string;
    data: HtxContractInfo[];
    ts: number;
  }>("/linear-swap-api/v1/swap_contract_info", { contract_code });

  if (resp.status !== "ok" || !Array.isArray(resp.data) || resp.data.length === 0) {
    // 如果拿不到，就保底用 1（整数价位），至少不会再报 1038
    if (process.env.DEBUG) {
      console.warn(
        "[WARN] 无法从 swap_contract_info 获取 price_tick，使用默认 1。原始返回:",
        JSON.stringify(resp).slice(0, 300)
      );
    }
    return 1;
  }

  const info = resp.data[0]!;
  const tick = Number(info.price_tick ?? 1);
  if (!tick || Number.isNaN(tick)) return 1;

  return tick;
}

// 按 tick 规范化价格
function normalizePriceToTick(
  price: number,
  tick: number,
  mode: "nearest" | "floor" | "ceil" = "nearest"
): number {
  if (tick <= 0) return price;

  const ratio = price / tick;
  let n: number;
  if (mode === "floor") n = Math.floor(ratio);
  else if (mode === "ceil") n = Math.ceil(ratio);
  else n = Math.round(ratio);

  const normalized = n * tick;

  // 根据 tick 的小数位数来 toFixed
  const tickStr = tick.toString();
  const decimals =
    tickStr.indexOf(".") >= 0 ? tickStr.length - tickStr.indexOf(".") - 1 : 0;

  return Number(normalized.toFixed(decimals));
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

// 统一账户仓位信息（简化版本类型）
type HtxUnifiedPosition = {
  margin_account: string;      // 比如 "USDT"
  contract_code: string;       // 比如 "BTC-USDT"
  direction: "buy" | "sell";
  volume: string;              // 持仓张数
  available: string;           // 可平数量
  // ... 其他字段你先不用管
};

export async function htxPerpGetUnifiedPositions(params?: {
  contract_code?: string;  // 可选：过滤某个合约
}) {
  const resp = await htxPerpPrivateRequest<{
    status?: string;
    code?: number;
    data: HtxUnifiedPosition[];
    ts: number;
  }>(
    "POST",
    "/linear-swap-api/v3/unified_account_position_info",
    {},
    params ?? {}
  );

  if (process.env.DEBUG) {
    console.log(
      "[DEBUG] unified_account_position_info 原始响应:",
      JSON.stringify(resp, null, 2)
    );
  }

  // 有的返回结构可能是 { data: { positions: [...] } }，如果你跑出来不是 data[]，这里再微调
  const list = Array.isArray(resp.data)
    ? resp.data
    : [];

  return list;
}

// 永续下单
export async function htxPerpPlaceOrder(params: {
  contract_code: string; // BTC-USDT
  volume: number; // 张数
  direction: "buy" | "sell";
  offset: "open" | "close";
  lever_rate: number;
  order_price_type: string; // "opponent" / "limit" 等
  price?: number;
}) {
  const path = "/linear-swap-api/v1/swap_cross_order";

  const bodyParams: Record<string, string> = {
    contract_code: params.contract_code,
    volume: String(params.volume),
    direction: params.direction,
    offset: params.offset,
    lever_rate: String(params.lever_rate),
    order_price_type: params.order_price_type,
  };

  if (params.price !== undefined) {
    bodyParams.price = String(params.price);
  }

  return await htxPerpPrivateRequest("POST", path, {}, bodyParams);
}

// ✅ 下 U 本位永续 TPSL 订单（止盈 / 止损）
// 文档对应: POST /linear-swap-api/v1/swap_cross_tpsl_order
export async function htxPerpPlaceTpslOrder(params: {
  contract_code: string;        // 如 "BTC-USDT"
  direction: "buy" | "sell";    // 触发后平仓方向：多单平仓用 "sell"
  volume: number;               // 关联的仓位张数（整数）

  // 止盈相关（可选，但至少 TP / SL 选一个）
  tp_trigger_price?: number;
  tp_order_price?: number;
  tp_order_price_type?: string; // "limit" | "optimal_5" 等

  // 止损相关（可选）
  sl_trigger_price?: number;
  sl_order_price?: number;
  sl_order_price_type?: string; // "limit" | "optimal_5" 等
}) {
  const path = "/linear-swap-api/v1/swap_cross_tpsl_order";

  // HTX 要求参数在 POST body 里
  const bodyParams: Record<string, string | number> = {
    contract_code: params.contract_code,
    direction: params.direction,
    volume: Math.floor(params.volume), // 确保是整数
  };

  // 止盈
  if (params.tp_trigger_price !== undefined) {
    bodyParams.tp_trigger_price = params.tp_trigger_price;
  }
  if (params.tp_order_price !== undefined) {
    bodyParams.tp_order_price = params.tp_order_price;
  }
  if (params.tp_order_price_type) {
    bodyParams.tp_order_price_type = params.tp_order_price_type;
  }

  // 止损
  if (params.sl_trigger_price !== undefined) {
    bodyParams.sl_trigger_price = params.sl_trigger_price;
  }
  if (params.sl_order_price !== undefined) {
    bodyParams.sl_order_price = params.sl_order_price;
  }
  if (params.sl_order_price_type) {
    bodyParams.sl_order_price_type = params.sl_order_price_type;
  }

  // 防御：如果 TP/SL 都没传，直接报错
  if (
    bodyParams.tp_trigger_price === undefined &&
    bodyParams.sl_trigger_price === undefined
  ) {
    throw new Error("htxPerpPlaceTpslOrder: 至少需要传入 TP 或 SL 中的一个触发价");
  }

  return await htxPerpPrivateRequest("POST", path, {}, bodyParams);
}

// ================= 持仓查询（关键） =================

export type HtxPosition = {
  contract_code: string;
  direction: "buy" | "sell";
  volume: number;
  avail_position: number;
  available?: number; // 可平数量（有些接口返回这个字段名）
  position_id: number;
  lever_rate: number;
  // 其他字段我们先不管
};

export async function htxPerpGetPositions(contract_code?: string) {
  const path = "/linear-swap-api/v1/swap_cross_position_info";

  // 注意：这个接口是 POST，参数在 body
  const body: Record<string, string> = {};
  if (contract_code) {
    body.contract_code = contract_code;
  }

  const resp = await htxPerpPrivateRequest<{
    status: string;
    data: HtxPosition[];
    ts: number;
  }>("POST", path, {}, body);

  if (process.env.DEBUG) {
    console.log(
      "[DEBUG] swap_cross_position_info 原始响应:",
      JSON.stringify(resp, null, 2)
    );
  }

  return resp;
}

// ==================== 简单版 TPSL （带 position_id） ====================

// 挂 TPSL：自动按合约 price_tick 规范化 TP/SL 价格，避免 1038 精度错误
export async function htxPerpPlaceTpslOrderSimple(params: {
  contract_code: string;          // BTC-USDT
  direction: "buy" | "sell";      // 仓位方向（多仓用 buy, 空仓用 sell）
  volume: number;                 // 要平掉的张数
  tp_trigger_price?: number;      // TP 触发价（可选）
  sl_trigger_price?: number;      // SL 触发价（可选）
  position_id?: number | string;  // 若有就传，精确绑定某个持仓
}) {
  const path = "/linear-swap-api/v1/swap_cross_tpsl_order";

  // 先查这个合约的 price_tick
  const tick = await getPriceTick(params.contract_code);

  let tpPriceNorm: number | undefined;
  let slPriceNorm: number | undefined;

  if (params.tp_trigger_price !== undefined) {
    // TP 价格按 tick 四舍五入
    tpPriceNorm = normalizePriceToTick(params.tp_trigger_price, tick, "nearest");
  }

  if (params.sl_trigger_price !== undefined) {
    // SL 价格也按 tick 四舍五入
    slPriceNorm = normalizePriceToTick(params.sl_trigger_price, tick, "nearest");
  }

  const body: Record<string, string> = {
    contract_code: params.contract_code,
    direction: params.direction,
    volume: String(params.volume),
    tpsl_order_type: "tpsl",
  };

  if (params.position_id !== undefined) {
    body.position_id = String(params.position_id);
  }

  if (tpPriceNorm !== undefined) {
    body.tp_trigger_price = String(tpPriceNorm);
    // 我们用 optimal_5，避免再单独传一个 limit 价（省心）
    body.tp_order_price = "0";
    body.tp_order_price_type = "optimal_5";
  }

  if (slPriceNorm !== undefined) {
    body.sl_trigger_price = String(slPriceNorm);
    body.sl_order_price = "0";
    body.sl_order_price_type = "optimal_5";
  }

  if (process.env.DEBUG) {
    console.log(
      "[DEBUG] TPSL 下单 body:",
      JSON.stringify(body, null, 2),
      " tick:",
      tick
    );
  }

  return await htxPerpPrivateRequest("POST", path, {}, body);
}