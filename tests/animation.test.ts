import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  ACTIONS,
  ANIMATION_DEFAULTS_VERSION,
  DEFAULT_DISABLED_ACTIONS,
  animationFrameAt,
  animationPreferences,
  selectActions,
} from '../app/shared/actions';

describe('默认动作与一次性迁移', () => {
  it('未配对、在线、忙碌都只默认播放新的趴姿动画', () => {
    for (const status of ['online', 'offline', 'busy'] as const)
      expect(selectActions(status, DEFAULT_DISABLED_ACTIONS).map((a) => a.id)).toEqual(['lounge']);
    expect(animationPreferences().disabledActions).toHaveLength(5);
  });
  it('旧版全部开启的设置采用本次新默认值', () => {
    expect(animationPreferences({ disabledActions: [] })).toEqual(animationPreferences());
  });
  it('迁移完成后保留手动开启的动作以及全部停用的选择', () => {
    const enabled = animationPreferences({
      animationDefaultsVersion: ANIMATION_DEFAULTS_VERSION,
      disabledActions: [],
    });
    expect(animationPreferences(enabled).disabledActions).toEqual([]);
    const disabled = ACTIONS.map((a) => a.id);
    expect(animationPreferences({ ...enabled, disabledActions: disabled }).disabledActions).toEqual(
      disabled,
    );
  });
});

describe('连续循环时间轴', () => {
  it('36 帧逐一显示 125 毫秒，末帧直接衔接首帧', () => {
    for (let i = 0; i < 36; i++) {
      expect(animationFrameAt([ACTIONS[0]], i * 125).frame).toBe(i);
      expect(animationFrameAt([ACTIONS[0]], i * 125 + 124).frame).toBe(i);
    }
    expect(animationFrameAt([ACTIONS[0]], 4500).frame).toBe(0);
    expect(animationFrameAt([ACTIONS[0]], 4625).frame).toBe(1);
  });
  it('超过原有的 8 秒也不重置或截断默认动作', () => {
    expect(animationFrameAt([ACTIONS[0]], 8000).frame).toBe(28);
    expect(animationFrameAt([ACTIONS[0]], 13500).frame).toBe(0);
  });
  it('手动启用其他动作后，趴姿完成两整圈再切换', () => {
    const choices = [ACTIONS[0], ACTIONS[1]];
    expect(animationFrameAt(choices, 8999)).toEqual({ action: ACTIONS[0], frame: 35 });
    expect(animationFrameAt(choices, 9000)).toEqual({ action: ACTIONS[1], frame: 0 });
    expect(animationFrameAt(choices, 17000)).toEqual({ action: ACTIONS[0], frame: 0 });
  });
  it('素材清单与播放器的实际帧数一致', () => {
    const manifest = JSON.parse(readFileSync('assets/pet/integrity.json', 'utf8'));
    for (const action of ACTIONS)
      expect(manifest.actions.find((a: { id: string }) => a.id === action.id).frames).toHaveLength(
        action.frames,
      );
  });
});
