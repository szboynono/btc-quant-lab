import axios from "axios";
import type { Candle } from "../types/candle.js";

const API = "https://api.binance.com/api/v3/klines";

/**
 * 拉取 4 小时 K 线，可指定多少根（超过 1000 会自动多次请求）
 */
export async function fetchBtc4hCandles(total: number): Promise<Candle[]> {
  const limit = 1000; // Binance 每次最多 1000 根
  const interval = "4h";

  let candles: Candle[] = [];
  let endTime = Date.now();

  while (candles.length < total) {
    const need = total - candles.length;
    const requestLimit = Math.min(need, limit);

    const url = `${API}?symbol=BTCUSDT&interval=${interval}&endTime=${endTime}&limit=${requestLimit}`;

    const res = await axios.get(url);
    const batch = res.data;

    if (batch.length === 0) break;

    const parsed = batch.map((n: any[]) => ({
      openTime: n[0],
      open: Number(n[1]),
      high: Number(n[2]),
      low: Number(n[3]),
      close: Number(n[4]),
      closeTime: n[6],
      volume: Number(n[5]),
    })) as Candle[];

    // 拼在前面（因为我们从最近往前拉）
    candles = [...parsed, ...candles];

    // 下一次请求往前挪
    const oldest = parsed[0];
    if (!oldest) {
      // No data fetched, prevent infinite loop and exit early
      break;
    }
    endTime = oldest.openTime - 1;

    // 防止 Binance 节流
    await new Promise((r) => setTimeout(r, 200));
  }

  return candles;
}