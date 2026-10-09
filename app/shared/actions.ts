import type { Presence } from './protocol';
export const ACTIONS = [
  { id: 'lounge', name: '趴姿晃头摆腿', frames: 8, fps: 5, states: ['online'] },
  { id: 'sway', name: '站立轻晃', frames: 8, fps: 5, states: ['online'] },
  { id: 'ponder', name: '抱胸摸下巴踱步', frames: 8, fps: 4, states: ['busy'] },
  { id: 'wait', name: '等待确认', frames: 8, fps: 4, states: ['offline', 'busy'] },
  { id: 'doze', name: '站着打盹', frames: 8, fps: 3, states: ['offline'] },
  { id: 'wave', name: '站立挥手', frames: 8, fps: 6, states: ['online'] },
] as const;
export type ActionId = (typeof ACTIONS)[number]['id'];
export function selectActions(status: Presence, disabled: readonly string[]) {
  const allowed = ACTIONS.filter((a) => !disabled.includes(a.id));
  const preferred = allowed.filter((a) => (a.states as readonly string[]).includes(status));
  return preferred.length ? preferred : allowed;
}
export function framePath(id: string, frame = 0) {
  return `./pet/${id}/frame_${String(frame + 1).padStart(2, '0')}.png`;
}
