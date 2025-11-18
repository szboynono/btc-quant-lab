import axios from "axios";
import type { Candle } from "../types/candle.js";

const API = "https://api.binance.com/api/v3/klines";

/**
 * 通用函数：按指定 interval 拉 K 线
 */
async function fetchCandles(
  interval: string,
  total: number
): Promise<Candle[]> {
  const limit = 1000; // Binance 最大 1000
  let candles: Candle[] = [];
  let endTime = Date.now();

  while (candles.length < total) {
    const need = total - candles.length;
    const reqLimit = Math.min(need, limit);

    const url = `${API}?symbol=BTCUSDT&interval=${interval}&endTime=${endTime}&limit=${reqLimit}`;

    const res = await axios.get(url);
    const batch = res.data;

    if (!batch || batch.length === 0) break;

    const parsed = batch.map((n: any[]) => ({
      openTime: n[0],
      open: Number(n[1]),
      high: Number(n[2]),
      low: Number(n[3]),
      close: Number(n[4]),
      closeTime: n[6],
      volume: Number(n[5]),
    })) as Candle[];

    // 新批次放前面（因为是从最近往前拉的）
    candles = [...parsed, ...candles];

    // 下一次请求往更旧的时间点挪动
    const oldest = parsed[0];
    if (!oldest) break;

    endTime = oldest.openTime - 1;

    // 轻微延迟，避免 API rate limit
    await new Promise((r) => setTimeout(r, 150));
  }

  return candles;
}

/**
 * 拉取 4 小时 K 线
 */
export async function fetchBtc4hCandles(total: number): Promise<Candle[]> {
  return fetchCandles("4h", total);
}

/**
 * 拉取 日线 1D K 线
 */
export async function fetchBtc1dCandles(total: number): Promise<Candle[]> {
  return fetchCandles("1d", total);
}
