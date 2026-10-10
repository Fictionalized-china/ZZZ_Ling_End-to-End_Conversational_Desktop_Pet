export type NetworkRoute = 'system' | 'direct';
export function retryableNetworkError(error: unknown) {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /ERR_(CONNECTION_(CLOSED|RESET|REFUSED|ABORTED|TIMED_OUT)|EMPTY_RESPONSE|PROXY_CONNECTION_FAILED|TUNNEL_CONNECTION_FAILED|TIMED_OUT|NETWORK_CHANGED|NAME_NOT_RESOLVED)|ECONNRESET|ECONNREFUSED|ETIMEDOUT|TimeoutError|AbortError|fetch failed|Opening handshake has timed out/i.test(
    text,
  );
}
export function networkErrorMessage(error: unknown) {
  const text = error instanceof Error ? error.message : String(error);
  if (/ERR_(CONNECTION_CLOSED|CONNECTION_RESET|EMPTY_RESPONSE)|ECONNRESET/i.test(text))
    return '连接被中途关闭，自动重试仍未成功，请检查网络或代理后重试';
  if (/ERR_(PROXY_CONNECTION_FAILED|TUNNEL_CONNECTION_FAILED)|ECONNREFUSED/i.test(text))
    return '代理或中继连接失败，请检查网络和代理设置后重试';
  if (/ERR_NAME_NOT_RESOLVED/i.test(text)) return '无法解析中继域名，请检查网络或连接地址';
  if (
    /timeout|timed.out|aborted/i.test(text) ||
    (error instanceof Error && /TimeoutError|AbortError/.test(error.name))
  )
    return '连接中继超时，请检查网络后重试';
  return text || '无法连接中继，请稍后重试';
}

// The caller reuses the same body/token. Retry only transport failures, never
// application errors (invalid code, a full room, rate limit or certificate errors).
export async function withNetworkRetry<T>(
  attempt: (route: NetworkRoute, signal: AbortSignal) => Promise<T>,
  initial: NetworkRoute,
  budget = 12_000,
  retrying?: () => void,
): Promise<{ value: T; route: NetworkRoute }> {
  const deadline = Date.now() + budget;
  const routes: NetworkRoute[] = [initial, initial, initial === 'system' ? 'direct' : 'system'];
  let last: unknown;
  for (let i = 0; i < routes.length; i++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    try {
      return {
        value: await attempt(routes[i], AbortSignal.timeout(Math.min(4000, remaining))),
        route: routes[i],
      };
    } catch (error) {
      last = error;
      if (!retryableNetworkError(error)) throw error;
      if (i < routes.length - 1 && deadline - Date.now() > 300) {
        retrying?.();
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
    }
  }
  throw new Error(networkErrorMessage(last));
}
