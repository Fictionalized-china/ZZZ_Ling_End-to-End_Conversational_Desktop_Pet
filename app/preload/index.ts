import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopApi } from '../shared/desktop';
const invoke = async (channel: string, ...args: unknown[]) => {
  const result = await ipcRenderer.invoke(channel, ...args);
  if (!result.ok) throw new Error(result.error);
  return result.value;
};
const api: DesktopApi = {
  getState: () => invoke('pet:state'),
  subscribe(callback) {
    const listener = (_event: unknown, state: Parameters<typeof callback>[0]) => callback(state);
    ipcRenderer.on('pet:update', listener);
    return () => ipcRenderer.removeListener('pet:update', listener);
  },
  setStatus: (choice) => invoke('pet:status', choice),
  setPreferences: (patch) => invoke('pet:preferences', patch),
  createPair: () => invoke('pet:create'),
  joinPair: (code) => invoke('pet:join', code),
  cancelPair: () => invoke('pet:cancel'),
  chooseImage: () => invoke('pet:image'),
  pasteImage: () => invoke('pet:paste'),
  sendText: (text) => invoke('pet:text', text),
  sendImage: (data) => invoke('pet:send-image', data),
  moveBy: (x, y) => ipcRenderer.send('pet:move', x, y),
  setLayout: (request) => ipcRenderer.send('pet:layout', request),
  setScale: (scale) => ipcRenderer.send('pet:scale', scale),
  setInteractive: (interactive) => ipcRenderer.send('pet:interactive', interactive),
  copyCode: () => invoke('pet:copy'),
  quit: () => ipcRenderer.send('pet:quit'),
};
contextBridge.exposeInMainWorld('pet', api);
