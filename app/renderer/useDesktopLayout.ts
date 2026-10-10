import { useLayoutEffect, useRef, useState } from 'react';
export function useDesktopLayout(
  ready: boolean,
  panel: string | null,
  messageId?: string,
  preview?: string | null,
) {
  const panelRef = useRef<HTMLElement>(null),
    bubbleRef = useRef<HTMLElement>(null);
  const [bubbleSize, setBubbleSize] = useState<{ width: number; height: number } | null>(null);
  useLayoutEffect(() => {
    if (!ready) return;
    let previous = '';
    const report = () => {
      const size = (node: HTMLElement | null) => {
        if (!node) return null;
        const rect = node.getBoundingClientRect();
        return { width: Math.ceil(rect.width), height: Math.ceil(rect.height) };
      };
      const request = {
        panel: panel || preview ? size(panelRef.current) : null,
        bubble: messageId ? size(bubbleRef.current) : null,
      };
      const key = JSON.stringify(request);
      if (key !== previous) {
        previous = key;
        setBubbleSize((current) =>
          current?.width === request.bubble?.width && current?.height === request.bubble?.height
            ? current
            : request.bubble,
        );
        window.pet?.setLayout(request);
      }
    };
    const observer = new ResizeObserver(report);
    if (panelRef.current) observer.observe(panelRef.current);
    if (bubbleRef.current) observer.observe(bubbleRef.current);
    report();
    return () => observer.disconnect();
  }, [ready, panel, messageId, preview]);
  return { panelRef, bubbleRef, bubbleSize };
}
