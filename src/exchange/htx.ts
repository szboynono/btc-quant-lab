// src/exchange/htx.ts
import type { Candle } from "../types/candle.js";

// 允许你以后改成镜像域名
const HTX_BASE_URL =
  process.env.HTX_BASE_URL ?? "https://api.huobi.pro";

/**
 * === 拉 4小时 K 线（已存在）===
 */
export async function fetchBtc4hCandles(
  limit: number = 3000
): Promise<Candle[]> {
  const maxSize = 2000;
  const size = Math.min(limit, maxSize);

  const url =
    `${HTX_BASE_URL}/market/history/kline` +
    `?symbol=btcusdt&period=4hour&size=${size}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTX 4H kline failed: ${res.status}`);
  }
  const body: any = await res.json();

  if (body.status !== "ok") {
    throw new Error("HTX 4H unexpected: " + JSON.stringify(body));
  }

  return body.data
    .map((d: any) => {
      const closeTime = Number(d.id) * 1000;
      const openTime = closeTime - 4 * 60 * 60 * 1000;
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
    .reverse();
}

/**
 * === 拉 1天 K 线（新加）===
 * 用于日线 Regime 过滤
 */
export async function fetchBtc1dCandles(
  limit: number = 500
): Promise<Candle[]> {
  const maxSize = 2000;
  const size = Math.min(limit, maxSize);

  const url =
    `${HTX_BASE_URL}/market/history/kline` +
    `?symbol=btcusdt&period=1day&size=${size}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTX 1D kline failed: ${res.status}`);
  }
  const body: any = await res.json();

  if (body.status !== "ok") {
    throw new Error("HTX 1D unexpected: " + JSON.stringify(body));
  }

  return body.data
    .map((d: any) => {
      const closeTime = Number(d.id) * 1000;
      const openTime = closeTime - 24 * 60 * 60 * 1000;
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
    .reverse();
}