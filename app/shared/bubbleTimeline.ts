import type { ChatMessage } from './desktop';

export type BubblePhase = 'idle' | 'visible' | 'changing' | 'fading';
export const BUBBLE_CHANGE_MS = 3000;
export const BUBBLE_FADE_MS = 4000;
export const BUBBLE_HIDE_MS = 6000;
export const CONTENT_FADE_MS = 250;

// 独立时钟，不因布局、消息确认或状态通知重新计时。
export class BubbleTimeline {
  message: ChatMessage | null = null;
  phase: BubblePhase = 'idle';
  nextAt: number | null = null;
  private session = '';
  private seen = new Set<string>();
  private queue: ChatMessage[] = [];
  private shownAt = 0;
  private changeAt: number | null = null;

  ingest(messages: ChatMessage[], session: string, now: number) {
    if (session !== this.session) {
      this.dismiss();
      this.seen.clear();
      this.session = session;
    }
    const retained = new Set(messages.map((message) => message.id));
    this.queue = this.queue.filter((message) => retained.has(message.id));
    for (const message of messages) {
      if (message.direction !== 'in' || this.seen.has(message.id)) continue;
      this.seen.add(message.id);
      if (!this.message) {
        this.message = message;
        this.shownAt = now;
      } else this.queue.push(message);
    }
    this.queue = this.queue.slice(-60);
    this.seen = new Set([...this.seen].filter((id) => retained.has(id)));
    if (this.queue.length && this.changeAt === null) this.changeAt = now + BUBBLE_CHANGE_MS;
    if (!this.queue.length) this.changeAt = null;
    this.tick(now);
  }

  tick(now: number) {
    if (!this.message) {
      this.phase = 'idle';
      this.nextAt = null;
      return;
    }
    if (this.changeAt !== null && now >= this.changeAt) {
      this.message = this.queue.shift() || null;
      this.shownAt = now;
      this.changeAt = this.queue.length ? now + BUBBLE_CHANGE_MS : null;
    }
    if (this.changeAt !== null) {
      this.phase = now >= this.changeAt - CONTENT_FADE_MS ? 'changing' : 'visible';
      this.nextAt = this.phase === 'changing' ? this.changeAt : this.changeAt - CONTENT_FADE_MS;
    } else if (now >= this.shownAt + BUBBLE_HIDE_MS) {
      this.dismiss();
    } else {
      this.phase = now >= this.shownAt + BUBBLE_FADE_MS ? 'fading' : 'visible';
      this.nextAt = this.shownAt + (this.phase === 'fading' ? BUBBLE_HIDE_MS : BUBBLE_FADE_MS);
    }
  }

  dismiss() {
    this.message = null;
    this.phase = 'idle';
    this.queue = [];
    this.changeAt = null;
    this.nextAt = null;
  }
}
