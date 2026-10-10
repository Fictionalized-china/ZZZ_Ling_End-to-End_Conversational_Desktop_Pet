import { useEffect, useRef, useState } from 'react';
import { ACTIONS, animationFrameAt, framePath, type ActionId } from '../shared/actions';

type AlphaMask = { width: number; height: number; data: Uint8Array };
type LoadedAction = {
  frames: { image: HTMLImageElement; alpha: AlphaMask }[];
  viewport: { x: number; y: number; width: number; height: number };
};
const cache = new Map<ActionId, Promise<LoadedAction>>();

function loadAction(action: (typeof ACTIONS)[number]) {
  let pending = cache.get(action.id);
  if (pending) return pending;
  pending = (async () => {
    // 先完成全部帧的解码，播放期间只绘制已就绪的图片。
    const images = await Promise.all(
      Array.from({ length: action.frames }, async (_, i) => {
        const image = new Image();
        image.src = framePath(action.id, i);
        await image.decode();
        return image;
      }),
    );
    const canvas = document.createElement('canvas');
    canvas.width = images[0].naturalWidth;
    canvas.height = images[0].naturalHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    let left = canvas.width,
      top = canvas.height,
      right = -1,
      bottom = -1;
    const frames = images.map((image) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0);
      const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const data = new Uint8Array(canvas.width * canvas.height);
      for (let i = 0; i < data.length; i++) {
        data[i] = rgba[i * 4 + 3];
        if (action.id === 'lounge' && data[i]) {
          const x = i % canvas.width,
            y = Math.floor(i / canvas.width);
          left = Math.min(left, x);
          right = Math.max(right, x);
          top = Math.min(top, y);
          bottom = Math.max(bottom, y);
        }
      }
      return { image, alpha: { width: canvas.width, height: canvas.height, data } };
    });
    // 新素材含较大的透明留白；全部帧共用同一显示范围，不裁掉角色像素，也不逐帧抖动。
    const viewport =
      right >= left
        ? { x: left, y: top, width: right - left + 1, height: bottom - top + 1 }
        : { x: 0, y: 0, width: canvas.width, height: canvas.height };
    return { frames, viewport };
  })();
  cache.set(action.id, pending);
  pending.catch(() => cache.delete(action.id));
  return pending;
}

export function usePetAnimation(
  choices: readonly (typeof ACTIONS)[number][],
  ready: boolean,
  reducedMotion: boolean,
  onError: (message: string) => void,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [viewportSize, setViewportSize] = useState({ width: 395, height: 229 });
  const alphaRef = useRef<(AlphaMask & { x: number; y: number }) | null>(null);
  const key = choices.map((a) => a.id).join(',');
  useEffect(() => {
    if (!ready) return;
    const selected = key ? ACTIONS.filter((a) => key.split(',').includes(a.id)) : [ACTIONS[0]];
    let cancelled = false,
      request = 0;
    void Promise.all(selected.map(loadAction))
      .then((loaded) => {
        if (cancelled || !canvasRef.current) return;
        const canvas = canvasRef.current,
          ctx = canvas.getContext('2d')!;
        const startedAt = performance.now();
        let previous = '';
        canvas.dataset.startedAt = String(startedAt);
        const draw = (now: number) => {
          if (cancelled) return;
          const { action, frame } = animationFrameAt(selected, now - startedAt);
          const current = `${action.id}:${frame}`;
          if (previous !== current) {
            const { frames, viewport } = loaded[selected.findIndex((a) => a.id === action.id)];
            if (canvas.width !== viewport.width || canvas.height !== viewport.height) {
              canvas.width = viewport.width;
              canvas.height = viewport.height;
              setViewportSize((current) =>
                current.width === viewport.width && current.height === viewport.height
                  ? current
                  : { width: viewport.width, height: viewport.height },
              );
            }
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(frames[frame].image, -viewport.x, -viewport.y);
            alphaRef.current = { ...frames[frame].alpha, x: viewport.x, y: viewport.y };
            canvas.setAttribute('aria-label', `铃宝：${action.name}`);
            canvas.dataset.action = action.id;
            canvas.dataset.frame = String(frame);
            canvas.dataset.ready = 'true';
            canvas.dataset.viewport = JSON.stringify(viewport);
            previous = current;
          }
          if (key && !reducedMotion) request = requestAnimationFrame(draw);
        };
        draw(startedAt);
      })
      .catch(() => {
        if (!cancelled) onError('动画素材加载失败，请重新下载完整的铃宝.exe');
      });
    return () => {
      cancelled = true;
      cancelAnimationFrame(request);
    };
  }, [key, ready, reducedMotion, onError]);
  return { canvasRef, alphaRef, viewportSize };
}
