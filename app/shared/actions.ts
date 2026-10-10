import type { Presence } from './protocol';
export const ACTIONS = [
  { id: 'lounge', name: '趴姿晃头摆腿', frames: 36, fps: 8, states: ['online'] },
  { id: 'sway', name: '站立轻晃', frames: 8, fps: 5, states: ['online'] },
  { id: 'ponder', name: '抱胸摸下巴踱步', frames: 8, fps: 4, states: ['busy'] },
  { id: 'wait', name: '等待确认', frames: 8, fps: 4, states: ['offline', 'busy'] },
  { id: 'doze', name: '站着打盹', frames: 8, fps: 3, states: ['offline'] },
  { id: 'wave', name: '站立挥手', frames: 8, fps: 6, states: ['online'] },
] as const;
export type ActionId = (typeof ACTIONS)[number]['id'];
export const ANIMATION_DEFAULTS_VERSION = 1;
export const DEFAULT_DISABLED_ACTIONS = ACTIONS.filter((a) => a.id !== 'lounge').map((a) => a.id);

// 旧版本的默认值是全部开启；只迁移一次，之后保留用户手动开启的动作。
export function animationPreferences(saved?: {
  animationDefaultsVersion?: unknown;
  disabledActions?: unknown;
}) {
  return {
    animationDefaultsVersion: ANIMATION_DEFAULTS_VERSION,
    disabledActions:
      saved?.animationDefaultsVersion === ANIMATION_DEFAULTS_VERSION &&
      Array.isArray(saved.disabledActions)
        ? [
            ...new Set(
              saved.disabledActions.filter((id): id is ActionId =>
                ACTIONS.some((a) => a.id === id),
              ),
            ),
          ]
        : [...DEFAULT_DISABLED_ACTIONS],
  };
}
export function selectActions(status: Presence, disabled: readonly string[]) {
  const allowed = ACTIONS.filter((a) => !disabled.includes(a.id));
  const preferred = allowed.filter((a) => (a.states as readonly string[]).includes(status));
  return preferred.length ? preferred : allowed;
}
export function framePath(id: string, frame = 0) {
  return `./pet/${id}/frame_${String(frame + 1).padStart(2, '0')}.png`;
}

// 多个动作轮换时也只在完整循环的边界切换，不能在固定秒数截断一圈。
export function animationFrameAt(actions: readonly (typeof ACTIONS)[number][], elapsedMs: number) {
  if (!actions.length) return { action: ACTIONS[0], frame: 0 };
  const durations = actions.map((a) => {
    const loop = (a.frames * 1000) / a.fps;
    return loop * Math.max(1, Math.ceil(8000 / loop));
  });
  let time = Math.max(0, elapsedMs) % durations.reduce((sum, duration) => sum + duration, 0);
  for (let i = 0; i < actions.length; i++) {
    if (time < durations[i]) {
      const action = actions[i];
      return { action, frame: Math.floor((time * action.fps) / 1000) % action.frames };
    }
    time -= durations[i];
  }
  return { action: actions[0], frame: 0 };
}
