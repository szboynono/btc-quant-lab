/**
 * 趋势策略信号
 */
export type Signal = "LONG" | "CLOSE_LONG" | "HOLD";

/**
 * 简单趋势策略：
 * - 用50EMA定义"多头"
 * - 规则：
 *   1. 从下向上突破50EMA -> 开多
 *   2. 从上向下跌破50EMA -> 平多
 */
export function detectSignal(
  price: number,
  prevPrice: number,
  emaValue: number,
  prevEmaValue: number,
  inPosition: boolean
): Signal {
  const crossUp = prevPrice <= prevEmaValue && price > emaValue;
  const crossDown = prevPrice >= prevEmaValue && price < emaValue;

  if (!inPosition && crossUp) {
    return "LONG";
  }
  if (inPosition && crossDown) {
    return "CLOSE_LONG";
  }
  return "HOLD";
}
