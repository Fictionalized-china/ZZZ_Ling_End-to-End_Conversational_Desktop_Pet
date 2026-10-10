import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  nativeImage,
  powerMonitor,
  screen,
} from 'electron';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Relay, normalizeRelay } from './relay';
import { ACTIONS, animationPreferences } from '../shared/actions';
import { MAX_IMAGE, MAX_DIMENSION, pngSize } from '../shared/protocol';
import {
  clampScale,
  desktopLayout,
  scaleAtAnchor,
  MIN_SCALE,
  MAX_SCALE,
  type LayoutRequest,
} from '../shared/layout';
import type { AppState, DraftImage, Preferences } from '../shared/desktop';
declare const __RELAY_URL__: string;

const profile = process.env.PET_TEST_PROFILE;
if (profile && /^[a-z0-9-]+$/.test(profile))
  app.setPath('userData', path.join(app.getPath('temp'), `dafeyu-test-${profile}`));
if (!app.requestSingleInstanceLock()) {
  app.exit(0);
}
let win: BrowserWindow | undefined,
  relay: Relay,
  quitting = false;
let anchor = { x: 220, y: 260 };
let layoutRequest: LayoutRequest = { panel: null, bubble: null };
let saveTimer: NodeJS.Timeout | undefined;
const defaults: Preferences = {
  ...animationPreferences(),
  scale: 1,
  alwaysOnTop: true,
  autoStart: false,
  relayUrl: __RELAY_URL__,
};
const state: AppState = {
  preferences: { ...defaults },
  own: 'online',
  peer: 'offline',
  effective: 'offline',
  connection: 'idle',
  paired: false,
  code: '',
  codeExpiresAt: 0,
  messages: [],
  notice: '打开菜单，与另一台电脑配对',
  dock: 'right',
};
function broadcast() {
  if (win && !win.isDestroyed()) win.webContents.send('pet:update', state);
}
async function save() {
  const dir = app.getPath('userData');
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, 'preferences.json'),
    JSON.stringify(state.preferences, null, 2),
    'utf8',
  );
}
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void save().catch(() => {}), 400);
}
function applyLayout() {
  if (!win) return;
  const area = screen.getDisplayNearestPoint(anchor).workArea;
  const next = desktopLayout(anchor, state.preferences.scale, layoutRequest, area);
  anchor = next.anchor;
  state.preferences.anchorX = anchor.x;
  state.preferences.anchorY = anchor.y;
  state.layout = next.layout;
  const old = win.getBounds();
  if (Object.entries(next.bounds).some(([key, value]) => old[key as keyof typeof old] !== value))
    win.setBounds(next.bounds);
  broadcast();
}
function toDraft(image: Electron.NativeImage): DraftImage {
  if (image.isEmpty()) throw new Error('未读取到图片');
  const size = image.getSize();
  if (size.width > MAX_DIMENSION || size.height > MAX_DIMENSION)
    image = image.resize({
      ...(size.width >= size.height ? { width: MAX_DIMENSION } : { height: MAX_DIMENSION }),
      quality: 'best',
    });
  const png = image.toPNG();
  if (png.length > MAX_IMAGE) throw new Error('图片超过 8 MB，请缩小图片后再发');
  const finalSize = image.getSize();
  return {
    dataUrl: `data:image/png;base64,${png.toString('base64')}`,
    width: finalSize.width,
    height: finalSize.height,
    bytes: png.length,
  };
}
function registerIpc() {
  const handle = (name: string, callback: (...args: any[]) => unknown) =>
    ipcMain.handle(name, async (event, ...args) => {
      if (event.sender !== win?.webContents) return { ok: false, error: '无效窗口' };
      try {
        return { ok: true, value: await callback(...args) };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : '操作失败，请重试' };
      }
    });
  handle('pet:state', () => state);
  handle('pet:status', (choice) => relay.setStatus(choice));
  handle('pet:create', () => relay.create());
  handle('pet:join', (code) => {
    if (typeof code !== 'string') throw new Error('配对码无效');
    return relay.join(code);
  });
  handle('pet:cancel', () => relay.cancel());
  handle('pet:text', (text) => relay.sendText(text));
  handle('pet:copy', () => {
    if (state.code) clipboard.writeText(state.code);
  });
  handle('pet:image', async () => {
    const chosen = await dialog.showOpenDialog(win!, {
      title: '选择图片',
      properties: ['openFile'],
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }],
    });
    if (chosen.canceled) return null;
    const { stat } = await import('node:fs/promises');
    if ((await stat(chosen.filePaths[0])).size > 25 * 1024 * 1024)
      throw new Error('原图超过 25 MB，请先缩小');
    return toDraft(nativeImage.createFromPath(chosen.filePaths[0]));
  });
  handle('pet:paste', () => {
    const image = clipboard.readImage();
    return image.isEmpty() ? null : toDraft(image);
  });
  handle('pet:send-image', (dataUrl) => {
    if (
      typeof dataUrl !== 'string' ||
      !dataUrl.startsWith('data:image/png;base64,') ||
      dataUrl.length > MAX_IMAGE * 1.4
    )
      throw new Error('图片格式不正确');
    const png = Buffer.from(dataUrl.slice(22), 'base64'),
      size = pngSize(png);
    if (!size || nativeImage.createFromBuffer(png).isEmpty()) throw new Error('图片损坏');
    relay.sendImage(png, size.width, size.height);
  });
  handle('pet:preferences', async (patch) => {
    if (!patch || typeof patch !== 'object') throw new Error('设置无效');
    const next = { ...state.preferences };
    if ('scale' in patch) {
      if (!Number.isFinite(patch.scale) || patch.scale < MIN_SCALE || patch.scale > MAX_SCALE)
        throw new Error('尺寸无效');
      next.scale = scaleAtAnchor(
        patch.scale,
        anchor,
        screen.getDisplayNearestPoint(anchor).workArea,
      );
    }
    if ('disabledActions' in patch) {
      if (
        !Array.isArray(patch.disabledActions) ||
        patch.disabledActions.some((id: unknown) => !ACTIONS.some((a) => a.id === id))
      )
        throw new Error('动作无效');
      next.disabledActions = [...new Set<string>(patch.disabledActions)];
    }
    if ('alwaysOnTop' in patch) {
      if (typeof patch.alwaysOnTop !== 'boolean') throw new Error('设置无效');
      next.alwaysOnTop = patch.alwaysOnTop;
    }
    if ('relayUrl' in patch) {
      next.relayUrl = patch.relayUrl ? normalizeRelay(patch.relayUrl) : '';
      if (next.relayUrl !== state.preferences.relayUrl) await relay.cancel(false);
    }
    if ('autoStart' in patch) {
      if (typeof patch.autoStart !== 'boolean') throw new Error('设置无效');
      const executable = process.env.PORTABLE_EXECUTABLE_FILE || app.getPath('exe');
      if (!app.isPackaged && patch.autoStart) throw new Error('开机自启请在打包后的 exe 中开启');
      app.setLoginItemSettings({ openAtLogin: patch.autoStart, path: executable, args: [] });
      next.autoStart = patch.autoStart;
    }
    state.preferences = next;
    if ('alwaysOnTop' in patch) win?.setAlwaysOnTop(next.alwaysOnTop, 'floating');
    if ('scale' in patch) applyLayout();
    await save();
    broadcast();
  });
  ipcMain.on('pet:move', (event, dx, dy) => {
    if (
      event.sender !== win?.webContents ||
      !Number.isFinite(dx) ||
      !Number.isFinite(dy) ||
      Math.abs(dx) > 2000 ||
      Math.abs(dy) > 2000
    )
      return;
    anchor = { x: Math.round(anchor.x + dx), y: Math.round(anchor.y + dy) };
    applyLayout();
    scheduleSave();
  });
  ipcMain.on('pet:layout', (event, value) => {
    if (event.sender !== win?.webContents || !value || typeof value !== 'object') return;
    const valid = (size: unknown) =>
      size === null ||
      (typeof size === 'object' &&
        size !== null &&
        Number.isFinite((size as any).width) &&
        Number.isFinite((size as any).height) &&
        (size as any).width > 0 &&
        (size as any).width <= 600 &&
        (size as any).height > 0 &&
        (size as any).height <= 600);
    if (!valid(value.panel) || !valid(value.bubble)) return;
    if (JSON.stringify(value) === JSON.stringify(layoutRequest)) return;
    layoutRequest = { panel: value.panel, bubble: value.bubble };
    applyLayout();
  });
  ipcMain.on('pet:scale', (event, value) => {
    if (event.sender !== win?.webContents || !Number.isFinite(value)) return;
    const scale = scaleAtAnchor(
      clampScale(value),
      anchor,
      screen.getDisplayNearestPoint(anchor).workArea,
    );
    if (scale === state.preferences.scale) return;
    state.preferences.scale = scale;
    applyLayout();
    scheduleSave();
  });
  ipcMain.on('pet:interactive', (event, value) => {
    if (event.sender === win?.webContents && typeof value === 'boolean')
      win?.setIgnoreMouseEvents(!value, { forward: true });
  });
  ipcMain.on('pet:quit', (event) => {
    if (event.sender === win?.webContents) app.quit();
  });
}

app.whenReady().then(async () => {
  try {
    const saved = JSON.parse(
      await readFile(path.join(app.getPath('userData'), 'preferences.json'), 'utf8'),
    );
    state.preferences = {
      ...defaults,
      ...animationPreferences(saved),
      scale: Number.isFinite(saved.scale) ? clampScale(saved.scale) : 1,
      alwaysOnTop: saved.alwaysOnTop !== false,
      autoStart: saved.autoStart === true,
      relayUrl: saved.relayUrl ? normalizeRelay(saved.relayUrl) : __RELAY_URL__,
      x: Number.isFinite(saved.x) ? saved.x : undefined,
      y: Number.isFinite(saved.y) ? saved.y : undefined,
      anchorX: Number.isFinite(saved.anchorX) ? saved.anchorX : undefined,
      anchorY: Number.isFinite(saved.anchorY) ? saved.anchorY : undefined,
    };
  } catch {}
  await save().catch(() => {});
  if (process.env.DAFEYU_RELAY_URL && !app.isPackaged)
    state.preferences.relayUrl = normalizeRelay(process.env.DAFEYU_RELAY_URL);
  const area = screen.getPrimaryDisplay().workArea;
  anchor = {
    x:
      state.preferences.anchorX ??
      (state.preferences.x !== undefined
        ? state.preferences.x + Math.max(360, 416 * state.preferences.scale + 24) / 2
        : area.x + area.width - 250),
    y:
      state.preferences.anchorY ??
      (state.preferences.y !== undefined
        ? state.preferences.y + 208 * state.preferences.scale + 30
        : area.y + area.height - 150),
  };
  anchor = { x: Math.round(anchor.x), y: Math.round(anchor.y) };
  win = new BrowserWindow({
    width: 440,
    height: 300,
    x: Math.round(anchor.x - 220),
    y: Math.round(anchor.y - 250),
    frame: false,
    transparent: true,
    resizable: false,
    hasShadow: false,
    alwaysOnTop: state.preferences.alwaysOnTop,
    skipTaskbar: false,
    title: '铃宝',
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: 'dafeyu-memory',
      devTools: !app.isPackaged,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  );
  win.webContents.session.setPermissionCheckHandler(() => false);
  relay = new Relay(state);
  relay.on('change', broadcast);
  registerIpc();
  applyLayout();
  win.setIgnoreMouseEvents(true, { forward: true });
  if (process.env.PET_DEV_URL && !app.isPackaged) await win.loadURL(process.env.PET_DEV_URL);
  else await win.loadFile(path.join(__dirname, '../ui/index.html'));
  win.webContents.once('did-finish-load', broadcast);
  powerMonitor.on('suspend', () => relay.reconnect());
  powerMonitor.on('resume', () => relay.reconnect());
  screen.on('display-metrics-changed', () => applyLayout());
  screen.on('display-removed', () => applyLayout());
});
app.on('second-instance', () => {
  win?.show();
  win?.focus();
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', (event) => {
  if (quitting || !relay) return;
  event.preventDefault();
  quitting = true;
  clearTimeout(saveTimer);
  void Promise.race([
    Promise.all([relay.cancel(false), save()]),
    new Promise((resolve) => setTimeout(resolve, 1800)),
  ]).finally(() => app.quit());
});
