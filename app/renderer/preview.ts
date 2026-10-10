// 仅开发服务器 ?preview=1 使用的视觉检查夹具，不进入生产界面。
import type { AppState, DesktopApi } from '../shared/desktop';
import { animationPreferences } from '../shared/actions';
const state: AppState = {
  preferences: {
    ...animationPreferences(),
    scale: 1,
    alwaysOnTop: true,
    autoStart: false,
    relayUrl: '',
  },
  own: 'online',
  peer: 'offline',
  effective: 'offline',
  connection: 'idle',
  paired: false,
  code: '',
  codeExpiresAt: 0,
  messages: [],
  notice: '浏览器视觉预览，配对请使用桌面程序',
  dock: 'right',
};
const listeners = new Set<(value: AppState) => void>();
const emit = () => {
  for (const listener of listeners) listener(structuredClone(state));
};
const unavailable = async () => {
  throw new Error('这是视觉检查预览，请在桌面程序中操作');
};
const api: DesktopApi = {
  getState: async () => structuredClone(state),
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  setStatus: async (choice) => {
    state.own = choice;
    emit();
  },
  setPreferences: async (patch) => {
    Object.assign(state.preferences, patch);
    emit();
  },
  createPair: unavailable,
  joinPair: unavailable,
  cancelPair: unavailable,
  chooseImage: async () => null,
  pasteImage: async () => null,
  sendText: unavailable,
  sendImage: unavailable,
  moveBy: () => {},
  setExpanded: () => {},
  setInteractive: () => {},
  copyCode: async () => {},
  quit: () => {},
};
window.pet = api;
