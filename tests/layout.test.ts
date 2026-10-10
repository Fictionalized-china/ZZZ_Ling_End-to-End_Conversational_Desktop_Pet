import { describe, expect, it } from 'vitest';
import { desktopLayout, dragScale, scaleAtAnchor, clampScale } from '../app/shared/layout';

describe('人物屏幕锚点独立于窗口外框', () => {
  for (const area of [
    { x: 0, y: 0, width: 1920, height: 1040 },
    { x: -1366, y: -50, width: 1366, height: 728 },
    { x: 1920, y: 0, width: 1024, height: 728 },
  ]) {
    it(`屏幕 ${area.x},${area.y} 四角开关面板、气泡均不改变人物位置`, () => {
      for (const x of [area.x, area.x + area.width])
        for (const y of [area.y, area.y + area.height]) {
          const base = desktopLayout({ x, y }, 1, { panel: null, bubble: null }, area);
          for (const request of [
            { panel: { width: 316, height: 520 }, bubble: null },
            { panel: null, bubble: { width: 180, height: 90 } },
            { panel: { width: 420, height: 340 }, bubble: { width: 320, height: 220 } },
            { panel: null, bubble: null },
          ]) {
            const next = desktopLayout(base.anchor, 1, request, area);
            expect(next.anchor).toEqual(base.anchor);
            expect(next.bounds.x + next.layout.body.x).toBe(base.bounds.x + base.layout.body.x);
            expect(next.bounds.y + next.layout.body.y).toBe(base.bounds.y + base.layout.body.y);
            expect(next.bounds.x).toBeGreaterThanOrEqual(area.x);
            expect(next.bounds.y).toBeGreaterThanOrEqual(area.y);
            expect(next.bounds.x + next.bounds.width).toBeLessThanOrEqual(area.x + area.width);
            expect(next.bounds.y + next.bounds.height).toBeLessThanOrEqual(area.y + area.height);
          }
        }
    });
  }
  it('拖动按位移连续缩放，限制大小且保持锚点', () => {
    const area = { x: 0, y: 0, width: 1920, height: 1040 };
    const anchor = { x: 700, y: 500 };
    const small = dragScale(1, 13, 9),
      large = dragScale(1, -31, -27);
    expect(small).toBeLessThan(1);
    expect(large).toBeGreaterThan(1);
    expect(small % 0.25).not.toBe(0);
    expect(dragScale(1, -1000, -1000)).toBe(1.35);
    expect(dragScale(1, 1000, 1000)).toBe(0.55);
    for (const value of [small, large, 0.55, 1.35])
      expect(desktopLayout(anchor, value, { panel: null, bubble: null }, area).anchor).toEqual(
        anchor,
      );
    const edge = desktopLayout({ x: 0, y: 0 }, 1, { panel: null, bubble: null }, area).anchor;
    const limited = scaleAtAnchor(1.35, edge, area);
    expect(limited).toBe(1);
    expect(desktopLayout(edge, limited, { panel: null, bubble: null }, area).anchor).toEqual(edge);
    expect(clampScale(1.2345)).toBe(1.235);
  });
});
