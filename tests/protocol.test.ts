import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  effectiveStatus,
  packImage,
  unpackImage,
  validText,
  MAX_TEXT,
  type Presence,
} from '../app/shared/protocol';
import { ACTIONS, selectActions } from '../app/shared/actions';
describe('通信状态门禁', () => {
  const states: Presence[] = ['online', 'busy', 'offline'];
  for (const own of states)
    for (const peer of states)
      it(`${own} / ${peer}`, () => {
        const expected =
          own === 'offline' || peer === 'offline'
            ? 'offline'
            : own === 'busy' || peer === 'busy'
              ? 'busy'
              : 'online';
        expect(effectiveStatus(own, peer)).toBe(expected);
        expect(effectiveStatus(own, peer, false)).toBe('offline');
      });
});
describe('消息边界', () => {
  it('拒绝空白、超长和非文字输入', () => {
    expect(validText('中文，hello')).toBe(true);
    expect(validText(' \n ')).toBe(false);
    expect(validText('字'.repeat(MAX_TEXT))).toBe(true);
    expect(validText('字'.repeat(MAX_TEXT + 1))).toBe(false);
    expect(validText({ text: 'a' })).toBe(false);
  });
  const png = readFileSync('assets/pet/wave/frame_01.png');
  const info = { id: '3c44c2d7-b292-49af-9081-807df1eb2fbc', epoch: 7, width: 192, height: 208 };
  it('二进制图片传输不改变字节', () => {
    const parsed = unpackImage(packImage(info, png));
    expect(parsed?.info).toEqual(info);
    expect(Buffer.from(parsed!.png)).toEqual(png);
  });
  it('拒绝截断、伪造尺寸和超长头', () => {
    expect(unpackImage(new Uint8Array([0, 0, 0, 255]))).toBeNull();
    const forged = packImage({ ...info, width: 100 }, png);
    expect(unpackImage(forged)).toBeNull();
    const packet = packImage(info, png);
    new DataView(packet.buffer).setUint32(0, 999999);
    expect(unpackImage(packet)).toBeNull();
  });
});
describe('禁用动作', () => {
  it('各状态不播放被剔除的动作', () => {
    for (const status of ['online', 'busy', 'offline'] as const) {
      const disabled = ['doze', 'lounge', 'ponder'];
      expect(selectActions(status, disabled).every((a) => !disabled.includes(a.id))).toBe(true);
    }
  });
  it('全部剔除返回空列表，交由界面静态兜底', () => {
    expect(
      selectActions(
        'online',
        ACTIONS.map((a) => a.id),
      ),
    ).toEqual([]);
  });
});
