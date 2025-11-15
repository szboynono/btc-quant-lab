import axios from "axios";
import type { Candle } from "../types/candle.js";

/**
 * 从Binance获取BTCUSDT 4小时K线
 */
export async function fetchBtc4hCandles(limit = 500): Promise<Candle[]> {
  const url = "https://api.binance.com/api/v3/klines";
  const params = {
    symbol: "BTCUSDT",
    interval: "4h",
    limit: limit.toString(),
  };

  try {
    const res = await axios.get(url, { params, timeout: 10000 });
    const raw = res.data as any[];

    const candles: Candle[] = raw.map((k) => ({
      openTime: k[0],
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
      closeTime: k[6],
    }));

    return candles;
  } catch (error) {
    throw new Error(`Failed to fetch candles from Binance: ${error}`);
  }
}
