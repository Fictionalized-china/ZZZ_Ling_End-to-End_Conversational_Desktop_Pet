import { describe, expect, it } from 'vitest';
import { bubbleMetrics, fitBubble, BUBBLE_INSETS } from '../app/shared/bubbleLayout';

describe('按内容与人物比例变化的通知气泡', () => {
  it('55% 下宽高各减半，最小等于待机气泡', () => {
    expect(bubbleMetrics(0.55).max).toEqual({ width: 148, height: 92 });
    expect(fitBubble(0.55, 12, () => 16.2)).toEqual({ width: 88, height: 62 });
    expect(fitBubble(0.55, 4000, () => 2000)).toEqual({ width: 148, height: 92 });
  });
  it('25% 到 150% 只允许在对应的最小／最大尺寸之间增长', () => {
    for (const [scale, width, height] of [
      [0.25, 67, 42],
      [0.55, 148, 92],
      [1, 269, 167],
      [1.5, 404, 251],
    ]) {
      const metrics = bubbleMetrics(scale);
      expect(metrics.max).toEqual({ width, height });
      for (const natural of [11, 60, 180, 4000]) {
        const size = fitBubble(
          scale,
          natural,
          (available) => Math.ceil(natural / available) * metrics.fontSize * 1.35,
        );
        expect(size.width).toBeGreaterThanOrEqual(metrics.min.width);
        expect(size.height).toBeGreaterThanOrEqual(metrics.min.height);
        expect(size.width).toBeLessThanOrEqual(width);
        expect(size.height).toBeLessThanOrEqual(height);
      }
    }
  });
  it('较长内容增大气泡，上限能容纳至少一行文字并保留边框留白', () => {
    const short = fitBubble(0.55, 12, () => 16.2);
    const long = fitBubble(0.55, 180, () => 100);
    expect(long.width).toBeGreaterThan(short.width);
    expect(long.height).toBeGreaterThan(short.height);
    for (const scale of [0.25, 0.55, 1, 1.5]) {
      const metrics = bubbleMetrics(scale);
      const innerHeight = metrics.max.height * (1 - BUBBLE_INSETS.top - BUBBLE_INSETS.bottom);
      expect(innerHeight).toBeGreaterThanOrEqual(metrics.fontSize * 1.35);
    }
  });
});
