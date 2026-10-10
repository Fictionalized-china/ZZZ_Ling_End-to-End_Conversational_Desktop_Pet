import { useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '../shared/desktop';

// 连发按接收顺序展示；每次换消息先让旧气泡淡出两秒。历史仍只在内存消息列表中。
export function useIncomingBubble(messages: ChatMessage[], session: string) {
  const [message, setMessage] = useState<ChatMessage | null>(null);
  const [fading, setFading] = useState(false);
  const current = useRef<ChatMessage | null>(null),
    queue = useRef<ChatMessage[]>([]);
  const seen = useRef(new Set<string>()),
    previousSession = useRef(session);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const advance = useRef<() => void>(() => {});
  advance.current = () => {
    if (timer.current || !queue.current.length) return;
    if (!current.current) {
      current.current = queue.current.shift()!;
      setMessage(current.current);
      setFading(false);
      if (queue.current.length)
        timer.current = setTimeout(() => {
          timer.current = undefined;
          advance.current();
        }, 180);
      return;
    }
    setFading(true);
    timer.current = setTimeout(() => {
      timer.current = undefined;
      current.current = queue.current.shift() || null;
      setMessage(current.current);
      setFading(false);
      if (queue.current.length)
        timer.current = setTimeout(() => {
          timer.current = undefined;
          advance.current();
        }, 180);
    }, 2000);
  };
  useEffect(() => {
    if (previousSession.current !== session) {
      clearTimeout(timer.current);
      timer.current = undefined;
      current.current = null;
      queue.current = [];
      seen.current.clear();
      setMessage(null);
      setFading(false);
      previousSession.current = session;
    }
    for (const item of messages) {
      if (item.direction !== 'in' || seen.current.has(item.id)) continue;
      seen.current.add(item.id);
      queue.current.push(item);
    }
    // 与主进程的 60 条内存消息上限一致，避免积累无界的通知队列。
    const retained = new Set(messages.map((m) => m.id));
    queue.current = queue.current.filter((item) => retained.has(item.id)).slice(-60);
    seen.current = new Set([...seen.current].filter((id) => retained.has(id)));
    advance.current();
  }, [messages, session]);
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      timer.current = undefined;
    },
    [],
  );
  const dismiss = () => {
    clearTimeout(timer.current);
    timer.current = undefined;
    queue.current = [];
    current.current = null;
    setMessage(null);
    setFading(false);
  };
  return { message, fading, dismiss };
}
