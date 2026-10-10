import { describe, expect, it } from 'vitest';
import { desktopLayout, dragScale, scaleAtAnchor, clampScale } from '../app/shared/layout';
import { bubbleMetrics } from '../app/shared/bubbleLayout';

describe('人物屏幕锚点独立于窗口外框', () => {
  for (const area of [
    { x: 0, y: 0, width: 1920, height: 1040 },
    { x: -1366, y: -50, width: 1366, height: 728 },
    { x: 1920, y: 0, width: 1024, height: 728 },
  ]) {
    it(`屏幕 ${area.x},${area.y} 四角开关面板、气泡均不改变人物位置`, () => {
      for (const scale of [0.25, 0.55, 1, 1.5])
        for (const x of [area.x, area.x + area.width])
          for (const y of [area.y, area.y + area.height]) {
            const base = desktopLayout({ x, y }, scale, { panel: null, bubble: null }, area);
            const metrics = bubbleMetrics(scale);
            for (const request of [
              { panel: null, bubble: metrics.min, controls: true },
              {
                panel: { width: 316, height: 520 },
                bubble: metrics.max,
                controls: true,
              },
              { panel: { width: 316, height: 520 }, bubble: null },
              { panel: null, bubble: { width: 180, height: 90 } },
              { panel: { width: 420, height: 340 }, bubble: { width: 320, height: 220 } },
              { panel: null, bubble: null },
            ]) {
              const next = desktopLayout(base.anchor, scale, request, area);
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
  it('人物底边贴合任务栏，操作栏与面板展开不会向上推人物', () => {
    const area = { x: 0, y: 0, width: 1920, height: 1040 };
    for (const scale of [0.25, 0.55, 1, 1.5]) {
      const base = desktopLayout(
        { x: 960, y: 1400 },
        scale,
        { panel: null, bubble: { width: 88, height: 62 } },
        area,
      );
      expect(base.anchor.y).toBe(1040);
      expect(base.bounds.y + base.bounds.height).toBe(1040);
      for (const panel of [null, { width: 356, height: 520 }]) {
        const next = desktopLayout(
          base.anchor,
          scale,
          { panel, bubble: { width: 88, height: 62 }, controls: true },
          area,
        );
        expect(next.anchor).toEqual(base.anchor);
        expect(next.bounds.y + next.layout.body.y + next.layout.body.height).toBe(1040);
        expect(next.bounds.y + next.layout.controls!.y + next.layout.controls!.height).toBeLessThan(
          1040 - Math.round(208 * scale),
        );
      }
    }
  });
  it('小气泡按参照向左下移动，保持人物锚点', () => {
    const area = { x: 0, y: 0, width: 1920, height: 1040 };
    const next = desktopLayout(
      { x: 960, y: 624 },
      1,
      { panel: null, bubble: { width: 88, height: 62 } },
      area,
    );
    const cloud = next.layout.bubble!,
      body = next.layout.body;
    expect(next.bounds.x + cloud.x).toBeCloseTo(
      Math.round(960 - 208 * 0.42 - 88 * 0.78 - 18 / 0.55),
      0,
    );
    expect(cloud.y - body.y).toBe(Math.round(20 + 38 / 0.55 - 62));
    expect(next.anchor).toEqual({ x: 960, y: 624 });
  });
  it('小人物没有 320 像素的透明占位，快捷面板按真实尺寸布局', () => {
    const area = { x: 0, y: 0, width: 1920, height: 1040 };
    const base = desktopLayout({ x: 80, y: 1040 }, 0.25, { panel: null, bubble: null }, area);
    expect(base.layout.body.width).toBe(136);
    const next = desktopLayout(
      base.anchor,
      0.25,
      { panel: { width: 240, height: 42 }, bubble: { width: 40, height: 28 } },
      area,
    );
    expect(next.layout.panel!.width).toBe(240);
    expect(next.layout.panel!.height).toBe(42);
    expect(next.layout.bubble!.width).toBe(40);
    expect(next.layout.bubble!.height).toBe(28);
    expect(next.anchor).toEqual(base.anchor);
  });
  it('拖动按位移连续缩放，限制大小且保持锚点', () => {
    const area = { x: 0, y: 0, width: 1920, height: 1040 };
    const anchor = { x: 700, y: 500 };
    const small = dragScale(1, 13, 9),
      large = dragScale(1, -31, -27);
    expect(small).toBeLessThan(1);
    expect(large).toBeGreaterThan(1);
    expect(small % 0.25).not.toBe(0);
    expect(dragScale(1, -1000, -1000)).toBe(1.5);
    expect(dragScale(1, 1000, 1000)).toBe(0.25);
    for (const value of [small, large, 0.25, 1.5])
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
