export type Choice = 'online' | 'busy';
export type Presence = Choice | 'offline';
export type Role = 'host' | 'guest';
export const LEASE_MS = 45_000;
export const HEARTBEAT_MS = 15_000;
export const MAX_TEXT = 4_000;
export const MAX_IMAGE = 8 * 1024 * 1024;
export const MAX_DIMENSION = 4096;
export const CODE_PATTERN = /^[A-HJ-NP-Z2-9]{10}$/;
export const ID_PATTERN = /^[a-f0-9-]{36}$/i;
export interface Snapshot {
  type: 'state';
  epoch: number;
  own: Choice;
  peer: Presence;
  paired: boolean;
  effective: Presence;
}
export interface ImageInfo {
  id: string;
  epoch: number;
  width: number;
  height: number;
}
export function effectiveStatus(own: Presence, peer: Presence, paired = true): Presence {
  if (!paired || own === 'offline' || peer === 'offline') return 'offline';
  return own === 'busy' || peer === 'busy' ? 'busy' : 'online';
}
export function validText(text: unknown): text is string {
  return typeof text === 'string' && text.trim().length > 0 && text.length <= MAX_TEXT;
}
export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 33 || bytes.length > MAX_IMAGE) return null;
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!sig.every((n, i) => bytes[i] === n)) return null;
  if (String.fromCharCode(...bytes.slice(12, 16)) !== 'IHDR') return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16),
    height = view.getUint32(20);
  if (width < 1 || height < 1 || width > MAX_DIMENSION || height > MAX_DIMENSION) return null;
  return { width, height };
}
export function packImage(info: ImageInfo, png: Uint8Array): Uint8Array {
  if (!ID_PATTERN.test(info.id) || !pngSize(png)) throw new Error('图片格式或大小不符合要求');
  const header = new TextEncoder().encode(JSON.stringify(info));
  const result = new Uint8Array(4 + header.length + png.length);
  new DataView(result.buffer).setUint32(0, header.length);
  result.set(header, 4);
  result.set(png, 4 + header.length);
  return result;
}
export function unpackImage(packet: Uint8Array): { info: ImageInfo; png: Uint8Array } | null {
  try {
    if (packet.length < 8 || packet.length > MAX_IMAGE + 1028) return null;
    const length = new DataView(packet.buffer, packet.byteOffset, packet.byteLength).getUint32(0);
    if (length < 1 || length > 1024 || 4 + length >= packet.length) return null;
    const info = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(packet.subarray(4, 4 + length)),
    );
    const png = packet.subarray(4 + length),
      size = pngSize(png);
    if (
      !size ||
      !ID_PATTERN.test(info.id) ||
      !Number.isSafeInteger(info.epoch) ||
      info.epoch < 0 ||
      info.width !== size.width ||
      info.height !== size.height
    )
      return null;
    return { info, png };
  } catch {
    return null;
  }
}
