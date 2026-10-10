import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '../shared/desktop';
import { BubbleTimeline, type BubblePhase } from '../shared/bubbleTimeline';

export function useIncomingBubble(messages: ChatMessage[], session: string) {
  const timeline = useRef(new BubbleTimeline());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [view, setView] = useState<{ message: ChatMessage | null; phase: BubblePhase }>({
    message: null,
    phase: 'idle',
  });
  const publish = useCallback(() => {
    const { message, phase } = timeline.current;
    setView((previous) =>
      previous.message === message && previous.phase === phase ? previous : { message, phase },
    );
  }, []);
  useEffect(() => {
    const update = () => {
      timeline.current.tick(Date.now());
      publish();
      clearTimeout(timer.current);
      const next = timeline.current.nextAt;
      if (next !== null) timer.current = setTimeout(update, Math.max(0, next - Date.now()));
    };
    timeline.current.ingest(messages, session, Date.now());
    update();
    return () => clearTimeout(timer.current);
  }, [messages, session, publish]);
  const dismiss = useCallback(() => {
    clearTimeout(timer.current);
    timeline.current.dismiss();
    publish();
  }, [publish]);
  return { ...view, dismiss };
}
