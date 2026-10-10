import { app, screen, ipcMain, type BrowserWindow } from 'electron';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { Relay } from '../app/main/relay';
import { animationPreferences } from '../app/shared/actions';
import type { AppState } from '../app/shared/desktop';
process.env.PET_TEST_PROFILE = 'ui-' + process.pid;
const scaleEvents: number[] = [];
ipcMain.on('pet:scale', (_event, value) => scaleEvents.push(value));
const profile = path.join(app.getPath('temp'), `dafeyu-test-${process.env.PET_TEST_PROFILE}`);
fs.mkdirSync(profile, { recursive: true });
fs.writeFileSync(
  path.join(profile, 'preferences.json'),
  JSON.stringify({
    ...animationPreferences(),
    scale: 1,
    x: 40,
    y: 30,
    alwaysOnTop: false,
    autoStart: false,
    relayUrl: 'http://127.0.0.1:8790',
  }),
);
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check: () => Promise<boolean> | boolean, label: string, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await check()) return;
    await wait(30);
  }
  throw Error('Timeout: ' + label);
}
const timeout = setTimeout(() => {
  console.error('Desktop UI test timed out');
  app.exit(1);
}, 50000);
app.on('browser-window-created', (_event, win: BrowserWindow) => {
  win.webContents.once('did-finish-load', async () => {
    let guest: Relay | undefined;
    try {
      const js = (code: string) => win.webContents.executeJavaScript(code);
      const state = (): Promise<AppState> => js('window.pet.getState()');
      const exists = (selector: string) =>
        js(`!!document.querySelector(${JSON.stringify(selector)})`);
      const click = async (selector: string) => {
        await js(`document.querySelector(${JSON.stringify(selector)}).click()`);
        await wait(120);
      };
      const toolbar = async (name: string) => {
        if (!(await exists('.toolbar'))) {
          await js(
            `document.querySelector('canvas.pet').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true}))`,
          );
          await wait(100);
        }
        if (name === '状态') {
          await click('.presence');
          return;
        }
        await js(
          `[...document.querySelectorAll('.toolbar button')].find(b=>b.textContent.includes(${JSON.stringify(name)})).click()`,
        );
        await wait(150);
      };
      const anchor = async () => {
        const r = await js(
          `(()=>{const r=document.querySelector('canvas.pet').getBoundingClientRect();return {x:r.left+r.width/2,y:r.bottom}})()`,
        );
        const b = win.getBounds();
        return { x: b.x + r.x, y: b.y + r.y };
      };
      const positions: Record<string, { x: number; y: number }> = {};
      const stable = async (label: string, base: { x: number; y: number }) => {
        const next = await anchor();
        positions[label] = next;
        assert.ok(
          Math.abs(next.x - base.x) <= 0.5 && Math.abs(next.y - base.y) <= 0.5,
          `${label} moved character: ${JSON.stringify({ base, next })}`,
        );
      };
      const capture = async (name: string) => {
        fs.mkdirSync(path.resolve('work'), { recursive: true });
        fs.writeFileSync(
          path.resolve('work', name + '.png'),
          (await win.webContents.capturePage()).toPNG(),
        );
      };
      await until(
        () => js(`document.querySelector('canvas.pet')?.dataset.ready==='true'`),
        'animation',
      );
      const base = await anchor();
      positions.initial = base;
      assert.equal(await exists('.quick-composer textarea'), false);
      assert.equal(await exists('.toolbar'), false);
      assert.equal(await exists('.idle-cloud'), true);
      await capture('ui-idle');
      await toolbar('菜单');
      await click('[aria-label="关闭弹窗"]');
      assert.equal(
        await js(`document.querySelector('.presence').getAttribute('aria-label')`),
        '自己的状态：在线',
      );
      await toolbar('菜单');
      await stable('menu-top-edge', base);
      assert.equal(await exists('.action-row'), false);
      await js(
        `[...document.querySelectorAll('button')].find(b=>b.textContent==='连接设置').click()`,
      );
      await wait(150);
      await stable('connection-settings', base);
      await click('[aria-label="关闭弹窗"]');
      await stable('menu-close', base);
      await toolbar('状态');
      await stable('status-top-edge', base);
      assert.deepEqual(
        await js(
          `[...document.querySelectorAll('.action-row [role="switch"]')].map(b=>b.getAttribute('aria-checked'))`,
        ),
        ['true', 'false', 'false', 'false', 'false', 'false'],
      );
      await click('[aria-label="忙碌模式"]');
      await stable('own-busy', base);
      assert.equal((await state()).own, 'busy');
      assert.equal(
        await js(`document.querySelector('.presence').getAttribute('aria-label')`),
        '自己的状态：忙碌',
      );
      await click('[aria-label="忙碌模式"]');
      await click('.action-row:nth-child(6) [role="switch"]');
      await stable('action-switch', base);
      await click('.action-row:nth-child(6) [role="switch"]');
      await capture('ui-status');
      await click('[aria-label="关闭弹窗"]');
      await toolbar('置顶');
      await stable('pin', base);
      // 先把人物移到工作区内部，再通过原生鼠标输入长按、拖动圆点。
      const area = screen.getDisplayNearestPoint({
        x: Math.round(base.x),
        y: Math.round(base.y),
      }).workArea;
      const edgePrefs = (await state()).preferences;
      await js(
        `window.pet.moveBy(${Math.round(area.x + area.width * 0.5 - edgePrefs.anchorX!)}, ${Math.round(area.y + area.height - edgePrefs.anchorY!)})`,
      );
      await wait(180);
      const atTaskbar = await anchor();
      assert.equal(atTaskbar.y, area.y + area.height, 'Character must reach the taskbar top');
      await click('[aria-label="收起操作栏"]');
      assert.equal(win.getBounds().y + win.getBounds().height, area.y + area.height);
      const feetGap = await js(
        `(()=>{const c=document.querySelector('canvas.pet'),r=c.getBoundingClientRect(),data=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let bottom=-1;for(let y=c.height-1;y>=0&&bottom<0;y--)for(let x=0;x<c.width;x++)if(data[(y*c.width+x)*4+3]>25){bottom=y;break;}return (c.height-bottom-1)*r.height/c.height;})()`,
      );
      assert.ok(feetGap <= 6, `Visible feet gap ${feetGap}`);
      await capture('ui-taskbar');
      await toolbar('状态');
      await stable('taskbar-status', atTaskbar);
      const controlsInside = await js(
        `(()=>{const r=document.querySelector('.toolbar').getBoundingClientRect();return r.top>=0 && r.bottom<=innerHeight})()`,
      );
      assert.equal(controlsInside, true);
      await capture('ui-taskbar-controls');
      await click('[aria-label="关闭弹窗"]');
      await click('[aria-label="打开快捷聊天"]');
      await stable('taskbar-quick', atTaskbar);
      await click('[aria-label="关闭弹窗"]');
      await toolbar('状态');
      await click('[aria-label="关闭弹窗"]');
      const beforeMove = (await state()).preferences;
      await js(
        `window.pet.moveBy(${Math.round(area.x + area.width * 0.5 - beforeMove.anchorX!)}, ${Math.round(area.y + area.height * 0.6 - beforeMove.anchorY!)})`,
      );
      await wait(150);
      const middle = await anchor();
      const handle = await js(
        `(()=>{const r=document.querySelector('.resize-handle').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`,
      );
      const bounds = win.getBounds(),
        globalX = bounds.x + Math.round(handle.x),
        globalY = bounds.y + Math.round(handle.y);
      win.setIgnoreMouseEvents(false);
      win.focus();
      // sendInputEvent 不会按下 Windows 的真实鼠标键；窗口移动时系统发来的
      // buttons=0 会取消合成事件的 capture。这里用一次真正的按住/移动/释放。
      const nativeStart = screen.dipToScreenPoint({ x: globalX, y: globalY });
      const dpiScale = screen.getDisplayNearestPoint({ x: globalX, y: globalY }).scaleFactor;
      scaleEvents.length = 0;
      await promisify(execFile)(
        'powershell.exe',
        [
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          path.resolve('scripts/native-resize.ps1'),
          '-X',
          String(nativeStart.x),
          '-Y',
          String(nativeStart.y),
          '-DpiScale',
          String(dpiScale),
          '-Window',
          win.getNativeWindowHandle().readBigUInt64LE().toString(),
        ],
        { windowsHide: true, timeout: 10000 },
      );
      await wait(150);
      const draggedScale = (await state()).preferences.scale;
      const dragSteps = [...new Set(scaleEvents.filter((value) => value > 1))];
      assert.ok(draggedScale > 1 && draggedScale < 1.35, `Native drag scale ${draggedScale}`);
      assert.ok(
        dragSteps.length >= 2 && dragSteps.at(-1)! > dragSteps[0],
        `Pointer capture must survive resizing: ${JSON.stringify(dragSteps)}`,
      );
      await stable('native-resize', middle);
      await js('window.pet.setScale(1)');
      await wait(150);
      await stable('resize-reset', middle);
      await click('[aria-label="收起操作栏"]');
      await capture('ui-idle');
      console.log(
        'PASS native UI: own status, sliding switches, anchored panels and continuous hold-drag resize',
      );
      await toolbar('菜单');
      await js(
        `[...document.querySelectorAll('button')].find(b=>b.textContent==='生成我的配对码').click()`,
      );
      await until(async () => !!(await state()).code, 'UI create pair');
      const fresh: AppState = {
        preferences: {
          ...animationPreferences(),
          scale: 1,
          alwaysOnTop: false,
          autoStart: false,
          relayUrl: 'http://127.0.0.1:8790',
        },
        own: 'online',
        peer: 'offline',
        effective: 'offline',
        connection: 'idle',
        paired: false,
        code: '',
        codeExpiresAt: 0,
        messages: [],
        notice: '',
        dock: 'right',
      };
      guest = new Relay(fresh);
      await guest.join((await state()).code);
      await until(
        async () => (await state()).effective === 'online' && guest!.state.effective === 'online',
        'both online',
      );
      await click('[aria-label="关闭弹窗"]');
      await stable('pair-and-close', middle);
      await click('[aria-label="收起操作栏"]');
      await click('[aria-label="打开快捷聊天"]');
      assert.equal(await exists('.quick-panel'), true);
      await capture('ui-quick');
      await stable('quick-open', middle);
      await js(
        `(()=>{const input=document.querySelector('.quick-composer textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'快捷输入框发送测试');input.dispatchEvent(new Event('input',{bubbles:true}));})()`,
      );
      await wait(80);
      await click('[aria-label="发送消息"]');
      await until(
        () => guest!.state.messages.some((m) => m.text === '快捷输入框发送测试'),
        'quick send',
      );
      await click('[aria-label="关闭弹窗"]');
      assert.equal(await exists('.floating-panel'), false);
      guest.sendText('第一条：在桌面上就能聊天。');
      const first = guest.state.messages.at(-1)!.id;
      await until(
        () =>
          js(
            `document.querySelector('.speech-bubble')?.dataset.messageId===${JSON.stringify(first)} && getComputedStyle(document.querySelector('.speech-bubble')).visibility==='visible'`,
          ),
        'first bubble',
      );
      await capture('ui-short-bubble');
      const alpha = await js(
        `(async()=>{const image=document.querySelector('.bubble-art img');await image.decode();const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);return {outside:ctx.getImageData(100,100,1,1).data[3],inside:ctx.getImageData(750,500,1,1).data[3]}})()`,
      );
      assert.equal(alpha.outside, 0);
      assert.ok(alpha.inside >= 250, 'Bubble interior should be opaque');
      await stable('first-bubble', middle);
      const shortSize = await js(
        `(()=>{const r=document.querySelector('.speech-bubble').getBoundingClientRect();return {width:r.width,height:r.height}})()`,
      );
      const started = Date.now();
      guest.sendText('第二条：长句会自动换行。'.repeat(16) + 'LongUnbrokenText'.repeat(30));
      const second = guest.state.messages.at(-1)!.id;
      const png = fs.readFileSync('assets/pet/lounge/frame_01.png');
      guest.sendImage(png, 448, 456);
      const third = guest.state.messages.at(-1)!.id;
      await until(() => exists('.speech-bubble.changing'), 'content transition starts');
      assert.equal(await js(`document.querySelector('.speech-bubble').dataset.messageId`), first);
      assert.equal(
        await js(`Number(getComputedStyle(document.querySelector('.speech-bubble')).opacity)`),
        1,
      );
      await until(
        () =>
          js(
            `document.querySelector('.speech-bubble')?.dataset.messageId===${JSON.stringify(second)}`,
          ),
        'second after three seconds',
      );
      const elapsed = Date.now() - started;
      assert.ok(elapsed >= 2900 && elapsed < 4000, `Replacement timing ${elapsed}ms`);
      const longSize = await js(
        `(()=>{const b=document.querySelector('.speech-bubble'),c=document.querySelector('.speech-content'),r=b.getBoundingClientRect(),i=c.getBoundingClientRect();return {width:r.width,height:r.height,scroll:c.scrollHeight,client:c.clientHeight,insets:[i.left-r.left,r.right-i.right,i.top-r.top,r.bottom-i.bottom]}})()`,
      );
      assert.equal(longSize.width, shortSize.width);
      assert.equal(longSize.height, shortSize.height);
      assert.equal(longSize.width, 296);
      assert.equal(longSize.height, 184);
      assert.ok(longSize.scroll > longSize.client);
      assert.deepEqual(longSize.insets, [48, 48, 44, 66]);
      await wait(300);
      await capture('ui-long-bubble');
      await js(`document.querySelector('.speech-content').scrollTop=100`);
      assert.ok(await js(`document.querySelector('.speech-content').scrollTop>0`));
      await stable('long-bubble', middle);
      await until(
        () =>
          js(
            `document.querySelector('.speech-bubble')?.dataset.messageId===${JSON.stringify(third)}`,
          ),
        'image placeholder after three seconds',
      );
      assert.equal(await js(`document.querySelector('.speech-content').innerText`), '【图片信息】');
      assert.equal(await exists('.speech-content img'), false);
      await stable('image-bubble', middle);
      await wait(300);
      await capture('ui-image-bubble');
      await until(() => exists('.speech-bubble.fading'), 'four-second fade');
      await wait(500);
      const fadingOpacity = await js(
        `Number(getComputedStyle(document.querySelector('.speech-bubble')).opacity)`,
      );
      assert.ok(fadingOpacity > 0 && fadingOpacity < 1);
      await until(() => exists('.idle-cloud'), 'six-second idle return');
      assert.equal(await exists('.speech-bubble'), false);
      await stable('idle-return', middle);
      await js(
        `document.querySelector('canvas.pet').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))`,
      );
      await until(() => exists('.chat-panel textarea'), 'double-click full chat');
      await stable('full-chat', middle);
      assert.equal(await js(`document.querySelectorAll('.messages .message').length`), 4);
      await until(
        () => js(`document.querySelector('.message-image img')?.complete===true`),
        'history image',
      );
      await wait(150);
      const imageInChat = await js(
        `(()=>{const i=document.querySelector('.message-image img').getBoundingClientRect(),m=document.querySelector('.messages').getBoundingClientRect();return i.height>0 && i.bottom<=m.bottom && i.top>=m.top})()`,
      );
      assert.equal(imageInChat, true, 'Newest image must be visible inside full chat');
      await capture('ui-history');
      await click('[aria-label="查看图片"]');
      await stable('image-preview', middle);
      await click('[aria-label="关闭图片预览"]');
      await stable('preview-close', middle);
      await js(
        `(()=>{const input=document.querySelector('.chat-panel textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'完整聊天窗口也能发送');input.dispatchEvent(new Event('input',{bubbles:true}));})()`,
      );
      await wait(80);
      await click('[aria-label="发送消息"]');
      await until(
        () => guest!.state.messages.some((m) => m.text === '完整聊天窗口也能发送'),
        'full chat send',
      );
      guest.setStatus('busy');
      await until(async () => (await state()).effective === 'busy', 'peer busy');
      assert.equal(await js(`document.querySelector('.quick-send').disabled`), true);
      await toolbar('状态');
      assert.equal(
        await js(`document.querySelector('.presence').getAttribute('aria-label')`),
        '自己的状态：在线',
      );
      await click('[aria-label="关闭弹窗"]');
      await js(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))`);
      await wait(80);
      assert.equal(await exists('.toolbar'), false);
      assert.equal(await exists('.quick-composer'), false);
      guest.setStatus('online');
      await until(async () => (await state()).effective === 'online', 'peer online');
      guest.sendText('取消配对时也应清除正在切换的消息。');
      await until(() => exists('.speech-bubble'), 'new bubble after history');
      guest.sendText('尚未显示的消息。');
      await until(() => exists('.speech-bubble.changing'), 'cancel during transition');
      await guest.cancel(false);
      await until(async () => !(await state()).code, 'peer exit releases pair');
      await wait(350);
      assert.equal(await exists('.speech-bubble'), false);
      assert.equal(await exists('.idle-cloud'), true);
      assert.equal((await state()).messages.length, 0);
      const saved = JSON.parse(fs.readFileSync(path.join(profile, 'preferences.json'), 'utf8'));
      assert.ok(Number.isFinite(saved.anchorX) && Number.isFinite(saved.anchorY));
      assert.ok(!('messages' in saved) && !('code' in saved));
      fs.writeFileSync(
        path.resolve('work/ui-verification.json'),
        JSON.stringify(
          {
            passed: true,
            positions,
            draggedScale,
            taskbarFeetGap: feetGap,
            replacementMilliseconds: elapsed,
            fadingOpacity,
            shortSize,
            longSize,
            historyCount: 5,
            relay: 'local real Worker',
            electron: process.versions.electron,
          },
          null,
          2,
        ),
      );
      console.log(
        'PASS real Worker + production Electron UI: hidden controls, quick/full chat, 3/4/6-second fixed bubbles, image placeholder, scrolling, busy gate and peer exit cleanup',
      );
      clearTimeout(timeout);
      await guest.cancel(false);
      app.quit();
    } catch (error) {
      console.error(error);
      clearTimeout(timeout);
      await guest?.cancel(false);
      app.exit(1);
    }
  });
});
require(path.resolve(process.env.DAFEYU_SMOKE_MAIN || 'dist/main/index.cjs'));
