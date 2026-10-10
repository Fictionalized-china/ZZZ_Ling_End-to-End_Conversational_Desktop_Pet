export const MIN_SCALE = 0.25;
export const MAX_SCALE = 1.5;
export const PET_HEIGHT = 208;
export const PET_TOP = 20;
export type Rect = { x: number; y: number; width: number; height: number };
export type LayoutRequest = {
  panel: { width: number; height: number } | null;
  bubble: { width: number; height: number } | null;
  controls?: boolean;
};
export type DesktopLayout = {
  width: number;
  height: number;
  body: Rect;
  panel: Rect | null;
  bubble: Rect | null;
  controls: Rect | null;
  maxPanelHeight: number;
};
const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(Math.max(min, max), n));
export function clampScale(value: number) {
  return Math.round(clamp(value, MIN_SCALE, MAX_SCALE) * 1000) / 1000;
}
export function dragScale(initial: number, dx: number, dy: number) {
  return clampScale(initial - (dx * 0.6 + dy * 0.8) / PET_HEIGHT);
}
export function scaleAtAnchor(value: number, anchor: { x: number; y: number }, area: Rect) {
  const horizontal =
    (2 * Math.min(anchor.x - area.x - 12, area.x + area.width - anchor.x - 12) - 32) / 416;
  const vertical = (anchor.y - area.y - PET_TOP - 12) / PET_HEIGHT;
  return clampScale(Math.min(value, horizontal, vertical));
}

// 原点是人物脚底中心的屏幕坐标。窗口的透明外框变化不能反过来改写这个原点。
export function desktopLayout(
  anchor: { x: number; y: number },
  scale: number,
  request: LayoutRequest,
  area: Rect,
) {
  const bodyWidth = Math.min(area.width - 24, Math.round(416 * scale + 32));
  const petHeight = Math.round(PET_HEIGHT * scale);
  const center = {
    x: Math.round(
      clamp(anchor.x, area.x + bodyWidth / 2 + 12, area.x + area.width - bodyWidth / 2 - 12),
    ),
    y: Math.round(clamp(anchor.y, area.y + petHeight + PET_TOP + 12, area.y + area.height)),
  };
  const body: Rect = {
    x: Math.round(center.x - bodyWidth / 2),
    y: center.y - petHeight - PET_TOP,
    width: bodyWidth,
    height: petHeight + PET_TOP,
  };
  const maxPanelHeight = Math.min(520, area.height - 24);
  const fit = (rect: Rect): Rect => ({
    ...rect,
    x: Math.round(clamp(rect.x, area.x + 12, area.x + area.width - rect.width - 12)),
    y: Math.round(clamp(rect.y, area.y + 12, area.y + area.height - rect.height - 12)),
  });
  let panel: Rect | null = null;
  if (request.panel) {
    const width = Math.min(440, area.width - 24, Math.max(180, Math.ceil(request.panel.width)));
    const height = Math.min(maxPanelHeight, Math.max(40, Math.ceil(request.panel.height)));
    const right = body.x + body.width + 12;
    const left = body.x - width - 12;
    panel = fit({
      x: right + width <= area.x + area.width - 12 ? right : left,
      y: body.y,
      width,
      height,
    });
  }
  const overlaps = (a: Rect, b: Rect) =>
    a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  const within = (r: Rect) =>
    r.x >= area.x + 12 &&
    r.y >= area.y + 12 &&
    r.x + r.width <= area.x + area.width - 12 &&
    r.y + r.height <= area.y + area.height;
  let bubble: Rect | null = null;
  if (request.bubble) {
    const width = Math.min(440, area.width - 24, Math.max(24, Math.ceil(request.bubble.width)));
    const height = Math.min(260, area.height - 24, Math.max(20, Math.ceil(request.bubble.height)));
    // 55% 为气泡参考尺寸，尾巴与脑袋的偏移一起缩放。
    // 云朵可以进入画布左上透明区，不反过来推动人物锚点。
    const ratio = scale / 0.55;
    const headX = center.x - petHeight * 0.42;
    const candidates = [
      {
        x: headX - width * 0.78 - 18 * ratio,
        y: body.y + PET_TOP + 38 * ratio - height,
        width,
        height,
      },
      { x: body.x - width - 12, y: body.y, width, height },
      { x: body.x + body.width + 12, y: body.y, width, height },
      { x: center.x - width / 2, y: body.y + body.height + 8, width, height },
    ];
    bubble =
      within(candidates[0]) && (!panel || !overlaps(candidates[0], panel))
        ? fit(candidates[0])
        : candidates
            .slice(1)
            .map(fit)
            .find((r) => !overlaps(r, body) && (!panel || !overlaps(r, panel))) ||
          fit(candidates[0]);
  }
  let controls: Rect | null = null;
  if (request.controls) {
    const width = Math.min(304, area.width - 24),
      height = 36;
    const above = Math.min(body.y, bubble?.y ?? body.y) - height - 8;
    const candidates = [
      { x: center.x - width / 2, y: center.y + 8, width, height },
      { x: center.x - width / 2, y: body.y - height - 8, width, height },
      { x: center.x - width / 2, y: above, width, height },
      { x: body.x + body.width - width, y: above, width, height },
      { x: body.x, y: above, width, height },
      { x: body.x + body.width + 12, y: center.y - height, width, height },
      { x: body.x - width - 12, y: center.y - height, width, height },
    ];
    controls =
      candidates
        .filter(within)
        .find(
          (r) =>
            !overlaps(r, body) &&
            (!panel || !overlaps(r, panel)) &&
            (!bubble || !overlaps(r, bubble)),
        ) || fit(candidates[2]);
  }
  const widgets = [
    body,
    ...(panel ? [panel] : []),
    ...(bubble ? [bubble] : []),
    ...(controls ? [controls] : []),
  ];
  const x = Math.floor(Math.min(...widgets.map((r) => r.x)) - 8);
  const y = Math.floor(Math.min(...widgets.map((r) => r.y)) - 8);
  const width = Math.ceil(Math.max(...widgets.map((r) => r.x + r.width)) + 8 - x);
  const height = Math.ceil(
    Math.min(area.y + area.height, Math.max(...widgets.map((r) => r.y + r.height)) + 8) - y,
  );
  const local = (r: Rect): Rect => ({ ...r, x: r.x - x, y: r.y - y });
  return {
    bounds: { x, y, width, height },
    anchor: center,
    layout: {
      width,
      height,
      body: local(body),
      panel: panel ? local(panel) : null,
      bubble: bubble ? local(bubble) : null,
      controls: controls ? local(controls) : null,
      maxPanelHeight,
    } satisfies DesktopLayout,
  };
}
