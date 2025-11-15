/**
 * 趋势策略信号
 */
export type Signal = "LONG" | "CLOSE_LONG" | "HOLD";

/**
 * 简单趋势策略：
 * - 用 50EMA 定义入场/出场信号
 * - 规则：
 *   1. 从下向上突破 50EMA -> 开多
 *   2. 从上向下跌破 50EMA -> 平多
 *   3. 其他情况 -> HOLD
 *
 * 注意：多头趋势过滤（200EMA）在 engine.ts 里做，
 * 这里不关心趋势，只负责“穿越”信号本身。
 */
export function detectSignal(
  price: number,
  prevPrice: number,
  ema50Value: number,
  prevEma50Value: number,
  inPosition: boolean
): Signal {
  const crossUp = prevPrice <= prevEma50Value && price > ema50Value;
  const crossDown = prevPrice >= prevEma50Value && price < ema50Value;

  if (!inPosition && crossUp) {
    return "LONG";
  }

  if (inPosition && crossDown) {
    return "CLOSE_LONG";
  }

  return "HOLD";
}