// 55% 人物下，大气泡上限是旧版 296×184 的宽高各一半。
export function bubbleMetrics(scale: number) {
  const ratio = scale / 0.55;
  return {
    ratio,
    min: { width: Math.round(88 * ratio), height: Math.round(62 * ratio) },
    max: { width: Math.round(148 * ratio), height: Math.round(92 * ratio) },
    fontSize: Math.max(11, Math.min(16, 12 * ratio)),
  };
}
// 与气泡图的奶油色内区一致；尾巴和装饰始终留在内容区以外。
export const BUBBLE_INSETS = { left: 48 / 296, right: 48 / 296, top: 44 / 184, bottom: 66 / 184 };
export function fitBubble(
  scale: number,
  naturalTextWidth: number,
  measureHeight: (contentWidth: number) => number,
) {
  const { min, max } = bubbleMetrics(scale);
  const widthFraction = 1 - BUBBLE_INSETS.left - BUBBLE_INSETS.right;
  const heightFraction = 1 - BUBBLE_INSETS.top - BUBBLE_INSETS.bottom;
  let width = Math.max(
    min.width,
    Math.min(max.width, Math.ceil((naturalTextWidth + 2) / widthFraction)),
  );
  let height = Math.max(
    min.height,
    Math.min(max.height, Math.ceil(measureHeight(width * widthFraction) / heightFraction)),
  );
  // 限制宽高比，短句与换行不会把手绘云朵拉成细条或细柱。
  width = Math.max(width, Math.min(max.width, Math.ceil((height * 88) / 62)));
  height = Math.max(height, Math.min(max.height, Math.ceil((width * 92) / 148)));
  return { width, height };
}
