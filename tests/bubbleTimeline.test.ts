import { describe, expect, it } from 'vitest';
import { BubbleTimeline } from '../app/shared/bubbleTimeline';
import type { ChatMessage } from '../app/shared/desktop';

const message = (id: string): ChatMessage => ({
  id,
  direction: 'in',
  kind: 'text',
  text: id,
  time: 0,
  delivery: 'delivered',
});
describe('气泡计时独立于状态刷新', () => {
  it('第 4 秒开始渐隐，第 6 秒回到待机，不重放历史', () => {
    const clock = new BubbleTimeline(),
      a = message('a');
    clock.ingest([a], 'room', 1000);
    clock.tick(4999);
    expect(clock.phase).toBe('visible');
    clock.ingest([{ ...a }], 'room', 5000);
    expect(clock.phase).toBe('fading');
    clock.tick(6999);
    expect(clock.message?.id).toBe('a');
    clock.tick(7000);
    expect(clock.phase).toBe('idle');
    clock.ingest([a], 'room', 8000);
    expect(clock.message).toBeNull();
  });
  it('连发按顺序每 3 秒替换，只在最后 250ms 淡出文字', () => {
    const clock = new BubbleTimeline(),
      a = message('a'),
      b = message('b'),
      c = message('c');
    clock.ingest([a], 'room', 0);
    clock.ingest([a, b, c], 'room', 1000);
    clock.tick(3749);
    expect(clock.phase).toBe('visible');
    clock.tick(3750);
    expect(clock.phase).toBe('changing');
    clock.tick(4000);
    expect(clock.message?.id).toBe('b');
    clock.ingest([a, b, c], 'room', 5000);
    clock.tick(7000);
    expect(clock.message?.id).toBe('c');
    clock.tick(11000);
    expect(clock.phase).toBe('fading');
    clock.tick(13000);
    expect(clock.phase).toBe('idle');
  });
  it('渐隐中收到消息恢复气泡，3 秒后切换', () => {
    const clock = new BubbleTimeline(),
      a = message('a'),
      b = message('b');
    clock.ingest([a], 'room', 0);
    clock.tick(4500);
    clock.ingest([a, b], 'room', 5000);
    expect(clock.phase).toBe('visible');
    clock.tick(6000);
    expect(clock.message?.id).toBe('a');
    clock.tick(8000);
    expect(clock.message?.id).toBe('b');
  });
  it('打开完整聊天后清空待显示队列，但新消息仍可显示', () => {
    const clock = new BubbleTimeline(),
      a = message('a'),
      b = message('b'),
      c = message('c');
    clock.ingest([a, b], 'room', 0);
    clock.dismiss();
    clock.ingest([a, b], 'room', 4000);
    expect(clock.message).toBeNull();
    clock.ingest([a, b, c], 'room', 5000);
    expect(clock.message?.id).toBe('c');
  });
  it('结束配对清除文字、图片及定时任务', () => {
    const clock = new BubbleTimeline();
    clock.ingest([message('a'), { ...message('b'), kind: 'image' }], 'room', 0);
    clock.ingest([], '', 1000);
    clock.tick(6000);
    expect(clock.message).toBeNull();
    expect(clock.nextAt).toBeNull();
  });
});
