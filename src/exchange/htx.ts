// src/exchange/htx.ts
import type { Candle } from "../types/candle.js";

// 允许你以后改成别的域名（比如镜像）
const HTX_BASE_URL =
  process.env.HTX_BASE_URL ?? "https://api.huobi.pro";

/**
 * 从 HTX 获取 BTCUSDT 4 小时 K 线
 * 注意：HTX 的 /market/history/kline 最多一次返回 2000 根
 * 这里我们拿最近的 size 根，然后按时间正序返回
 */
export async function fetchBtc4hCandles(
  limit: number = 3000
): Promise<Candle[]> {
  // HTX 单次最多 2000，这里做个上限
  const maxSize = 2000;
  const size = Math.min(limit, maxSize);

  const url =
    `${HTX_BASE_URL}/market/history/kline` +
    `?symbol=btcusdt&period=4hour&size=${size}`;

  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `HTX kline request failed: ${res.status} ${res.statusText} ${text}`
    );
  }

  const body: any = await res.json();

  if (body.status !== "ok" || !Array.isArray(body.data)) {
    throw new Error(
      "Unexpected HTX response: " +
        JSON.stringify(body).slice(0, 300)
    );
  }

  // HTX 返回是「最新在前」，我们需要按时间正序
  const raw = body.data as any[];

  const candles: Candle[] = raw
    .map((d) => {
      // docs: id 为该 K 线的「结束时间」秒级时间戳
      const closeTime = Number(d.id) * 1000; // 转 ms
      const openTime = closeTime - 4 * 60 * 60 * 1000; // 4 小时

      return {
        openTime,
        open: Number(d.open),
        high: Number(d.high),
        low: Number(d.low),
        close: Number(d.close),
        volume: Number(d.vol ?? d.amount ?? 0),
        closeTime,
      } satisfies Candle;
    })
    .reverse(); // 变成时间从早到晚

  // limit 目前 <= size，这里只是防御性代码
  if (limit < candles.length) {
    return candles.slice(-limit);
  }

  return candles;
}