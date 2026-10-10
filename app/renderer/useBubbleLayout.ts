import { useLayoutEffect, useState } from 'react';
import { bubbleMetrics, fitBubble } from '../shared/bubbleLayout';
import type { ChatMessage } from '../shared/desktop';

export function useBubbleLayout(scale: number, message: ChatMessage | null) {
  const text = message ? (message.kind === 'image' ? '【图片信息】' : message.text || '') : '';
  const metrics = bubbleMetrics(scale);
  const [measured, setMeasured] = useState({ text: '', scale: 0, ...metrics.min });
  useLayoutEffect(() => {
    if (!message) return;
    const probe = document.createElement('div');
    const family = getComputedStyle(document.documentElement).fontFamily;
    Object.assign(probe.style, {
      position: 'fixed',
      visibility: 'hidden',
      pointerEvents: 'none',
      fontFamily: family,
      fontSize: `${metrics.fontSize}px`,
      lineHeight: '1.35',
      whiteSpace: 'pre-wrap',
      overflowWrap: 'anywhere',
      padding: '0',
      border: '0',
    });
    probe.textContent = text;
    document.body.append(probe);
    const context = document.createElement('canvas').getContext('2d')!;
    context.font = `${metrics.fontSize}px ${family}`;
    const natural = Math.max(...text.split('\n').map((line) => context.measureText(line).width));
    const size = fitBubble(scale, natural, (width) => {
      probe.style.width = `${width}px`;
      return probe.getBoundingClientRect().height;
    });
    probe.remove();
    setMeasured((previous) =>
      previous.text === text &&
      previous.scale === scale &&
      previous.width === size.width &&
      previous.height === size.height
        ? previous
        : { text, scale, ...size },
    );
  }, [text, scale, !!message, metrics.fontSize]);
  return {
    ...metrics,
    size: message && measured.text === text && measured.scale === scale ? measured : metrics.min,
  };
}
