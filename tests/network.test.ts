import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  withNetworkRetry,
  networkErrorMessage,
  retryableNetworkError,
  type NetworkRoute,
} from '../app/shared/network';
afterEach(() => vi.useRealTimers());
describe('配对连接恢复', () => {
  it('连接被关闭后重试，仍失败则切换路由并返回成功路由', async () => {
    vi.useFakeTimers();
    const routes: NetworkRoute[] = [];
    const result = withNetworkRetry(async (route) => {
      routes.push(route);
      if (route === 'system') throw Error('net::ERR_CONNECTION_CLOSED');
      return { code: 'ABCDEFGH23' };
    }, 'system');
    await vi.runAllTimersAsync();
    expect(await result).toEqual({ value: { code: 'ABCDEFGH23' }, route: 'direct' });
    expect(routes).toEqual(['system', 'system', 'direct']);
  });
  it('短暂故障恢复后继续使用原路由', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const result = withNetworkRetry(async () => {
      if (++calls === 1) throw Error('net::ERR_CONNECTION_CLOSED');
      return true;
    }, 'system');
    await vi.runAllTimersAsync();
    expect(await result).toEqual({ value: true, route: 'system' });
    expect(calls).toBe(2);
  });
  it('业务拒绝和证书错误不重试', async () => {
    for (const text of [
      '这组配对已有两人',
      '创建过于频繁，请稍后再试',
      'net::ERR_CERT_AUTHORITY_INVALID',
    ]) {
      const attempt = vi.fn(async () => {
        throw Error(text);
      });
      await expect(withNetworkRetry(attempt, 'system')).rejects.toThrow(text);
      expect(attempt).toHaveBeenCalledTimes(1);
    }
  });
  it('失败次数有限，并显示中文原因', async () => {
    vi.useFakeTimers();
    const attempt = vi.fn(async () => {
      throw Error('net::ERR_CONNECTION_CLOSED');
    });
    const assertion = expect(withNetworkRetry(attempt, 'system')).rejects.toThrow('连接被中途关闭');
    await vi.runAllTimersAsync();
    await assertion;
    expect(attempt).toHaveBeenCalledTimes(3);
    expect(retryableNetworkError(Error('net::ERR_CONNECTION_CLOSED'))).toBe(true);
    expect(networkErrorMessage(new DOMException('Timed out', 'TimeoutError'))).toContain('超时');
  });
});
