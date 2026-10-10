import { app, screen, ipcMain, type BrowserWindow } from 'electron';
import path from 'node:path';
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
      assert.equal(await exists('.quick-composer textarea'), true);
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
      await js(
        `window.__pointerLog=[];for(const name of ['pointerdown','pointermove','pointerup','lostpointercapture'])document.addEventListener(name,e=>window.__pointerLog.push({name,buttons:e.buttons,target:e.target.className,screenX:e.screenX,screenY:e.screenY,clientX:e.clientX,clientY:e.clientY}));`,
      );
      win.webContents.sendInputEvent({
        type: 'mouseMove',
        x: Math.round(handle.x),
        y: Math.round(handle.y),
        globalX,
        globalY,
      });
      await wait(50);
      win.webContents.sendInputEvent({
        type: 'mouseDown',
        x: Math.round(handle.x),
        y: Math.round(handle.y),
        globalX,
        globalY,
        button: 'left',
        clickCount: 1,
      });
      await wait(240);
      win.webContents.sendInputEvent({
        type: 'mouseMove',
        x: Math.round(handle.x) - 20,
        y: Math.round(handle.y) - 30,
        globalX: globalX - 20,
        globalY: globalY - 30,
        button: 'left',
        modifiers: ['leftButtonDown'],
      });
      await wait(120);
      const firstDragScale = (await state()).preferences.scale;
      const secondBounds = win.getBounds();
      win.webContents.sendInputEvent({
        type: 'mouseMove',
        x: globalX - 36 - secondBounds.x,
        y: globalY - 48 - secondBounds.y,
        globalX: globalX - 36,
        globalY: globalY - 48,
        button: 'left',
        modifiers: ['leftButtonDown'],
      });
      await wait(120);
      const movedBounds = win.getBounds();
      win.webContents.sendInputEvent({
        type: 'mouseUp',
        x: globalX - 36 - movedBounds.x,
        y: globalY - 48 - movedBounds.y,
        globalX: globalX - 36,
        globalY: globalY - 48,
        button: 'left',
        clickCount: 1,
      });
      await wait(150);
      const draggedScale = (await state()).preferences.scale;
      if (draggedScale === 1)
        console.log('Resize input diagnostics:', await js('window.__pointerLog'), scaleEvents);
      assert.ok(draggedScale > 1 && draggedScale < 1.35, `Native drag scale ${draggedScale}`);
      assert.ok(
        draggedScale > firstDragScale,
        'Pointer capture must survive resizing for continuous drag',
      );
      await stable('native-resize', middle);
      await js('window.pet.setScale(1)');
      await wait(150);
      await stable('resize-reset', middle);
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
      await js(
        `(()=>{const input=document.querySelector('.quick-composer textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'常驻输入框发送测试');input.dispatchEvent(new Event('input',{bubbles:true}));})()`,
      );
      await wait(80);
      await click('[aria-label="发送消息"]');
      await until(
        () => guest!.state.messages.some((m) => m.text === '常驻输入框发送测试'),
        'quick send',
      );
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
      await until(() => exists('.speech-bubble.fading'), 'fade starts');
      await wait(500);
      const fading = await js(
        `(()=>{const b=document.querySelector('.speech-bubble');return {id:b.dataset.messageId,opacity:Number(getComputedStyle(b).opacity),count:document.querySelectorAll('.speech-bubble').length}})()`,
      );
      assert.equal(fading.id, first);
      assert.equal(fading.count, 1);
      assert.ok(fading.opacity > 0 && fading.opacity < 1);
      await until(
        () =>
          js(
            `document.querySelector('.speech-bubble')?.dataset.messageId===${JSON.stringify(second)}`,
          ),
        'second after fade',
      );
      const elapsed = Date.now() - started;
      assert.ok(elapsed >= 1900 && elapsed < 3500, `Fade timing ${elapsed}ms`);
      const longSize = await js(
        `(()=>{const b=document.querySelector('.speech-bubble'),c=document.querySelector('.speech-content'),r=b.getBoundingClientRect();return {width:r.width,height:r.height,scroll:c.scrollHeight,client:c.clientHeight}})()`,
      );
      assert.ok(
        longSize.width <= 320 && longSize.height <= 220 && longSize.scroll > longSize.client,
      );
      assert.ok(longSize.height > shortSize.height);
      await stable('long-bubble', middle);
      await until(
        () =>
          js(
            `document.querySelector('.speech-bubble')?.dataset.messageId===${JSON.stringify(third)}`,
          ),
        'image after second fade',
      );
      await until(
        () => js(`document.querySelector('.bubble-image img')?.complete===true`),
        'bubble image loaded',
      );
      await until(
        () =>
          js(
            `(()=>{const b=document.querySelector('.speech-bubble'),r=b.getBoundingClientRect(),p=document.querySelector('.pet-zone').getBoundingClientRect();return getComputedStyle(b).visibility==='visible' && (r.bottom<=p.top||r.right<=p.left||r.left>=p.right||r.top>=p.bottom)})()`,
          ),
        'image bubble settled without overlapping character',
      );
      assert.equal(await exists('.floating-panel'), false);
      await stable('image-bubble', middle);
      await capture('ui-image-bubble');
      const imageSize = await js(
        `(()=>{const r=document.querySelector('.bubble-image img').getBoundingClientRect();return {width:r.width,height:r.height}})()`,
      );
      assert.ok(imageSize.width <= 200 && imageSize.height <= 140);
      await click('[aria-label="查看收到的图片"]');
      await stable('image-preview', middle);
      await click('[aria-label="关闭图片预览"]');
      await stable('preview-close', middle);
      await click('[aria-label="打开对话记录"]');
      await stable('history', middle);
      assert.equal(await exists('.speech-bubble'), false);
      assert.equal(await js(`document.querySelectorAll('.messages .message').length`), 4);
      await capture('ui-history');
      await click('[aria-label="关闭弹窗"]');
      await wait(300);
      assert.equal(await exists('.speech-bubble'), false);
      guest.setStatus('busy');
      await until(async () => (await state()).effective === 'busy', 'peer busy');
      assert.equal(
        await js(`document.querySelector('.presence').getAttribute('aria-label')`),
        '自己的状态：在线',
      );
      assert.equal(await js(`document.querySelector('.quick-send').disabled`), true);
      guest.setStatus('online');
      await until(async () => (await state()).effective === 'online', 'peer online');
      guest.sendText('取消配对时也应清除正在淡出的消息。');
      await until(() => exists('.speech-bubble'), 'new bubble after history');
      guest.sendText('尚未显示的消息。');
      await until(() => exists('.speech-bubble.fading'), 'cancel during fade');
      await js('window.pet.cancelPair()');
      await wait(2300);
      assert.equal(await exists('.speech-bubble'), false);
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
            fadeMilliseconds: elapsed,
            fadingOpacity: fading.opacity,
            shortSize,
            longSize,
            imageSize,
            historyCount: 4,
            relay: 'local real Worker',
            electron: process.versions.electron,
          },
          null,
          2,
        ),
      );
      console.log(
        'PASS real Worker + production Electron UI: quick send, 2-second FIFO text/image bubbles, bounded wrapping, history, busy gate and cancellation cleanup',
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
