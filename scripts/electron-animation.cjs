// 实际 Electron：旧设置迁移、连续两圈、面板与状态不重置、静态与手动启用。
const { app, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const interactiveMessages = [];
ipcMain.on('pet:interactive', (_event, value) => interactiveMessages.push(value));
process.env.PET_TEST_PROFILE = 'animation-' + process.pid;
const profile = path.join(app.getPath('temp'), `dafeyu-test-${process.env.PET_TEST_PROFILE}`);
fs.mkdirSync(profile, { recursive: true });
fs.writeFileSync(
  path.join(profile, 'preferences.json'),
  JSON.stringify({
    disabledActions: [],
    scale: 1.25,
    alwaysOnTop: false,
    autoStart: false,
    relayUrl: process.env.DAFEYU_EXPECT_RELAY_URL || 'https://dafeyu.tap041120.online',
  }),
);
const timeout = setTimeout(() => {
  console.error('Animation test timed out');
  app.exit(1);
}, 30000);
app.on('browser-window-created', (_event, win) => {
  win.webContents.once('did-finish-load', async () => {
    try {
      win.webContents.debugger.attach('1.3');
      await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
      });
      const result = await win.webContents.executeJavaScript(`(async () => {
        const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
        for (let i=0; i<80 && document.querySelector('canvas.pet')?.dataset.ready!=='true'; i++) await wait(50);
        const canvas = document.querySelector('canvas.pet');
        if (!canvas || canvas.dataset.ready!=='true') throw Error('Animation did not load');
        const initial = await window.pet.getState();
        const samples = [{ frame: Number(canvas.dataset.frame), time: performance.now(), startedAt: canvas.dataset.startedAt }];
        const observer = new MutationObserver(() => samples.push({
          frame: Number(canvas.dataset.frame), time: performance.now(), startedAt: canvas.dataset.startedAt,
        }));
        observer.observe(canvas, {attributes:true, attributeFilter:['data-frame']});
        const start = canvas.dataset.startedAt;
        await wait(300);
        [...document.querySelectorAll('.toolbar button')].find(b=>b.textContent.includes('状态')).click();
        await wait(350);
        const menuChecks = [...document.querySelectorAll('.action-row [role="switch"]')].map(i=>i.getAttribute('aria-checked')==='true');
        document.querySelector('[aria-label="关闭弹窗"]').click();
        await wait(350); await window.pet.setStatus('busy');
        await wait(350); await window.pet.setStatus('online');
        canvas.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
        await wait(350);
        const composerOpened = !!document.querySelector('textarea[aria-label="消息内容"]');
        document.querySelector('[aria-label="关闭弹窗"]').click();
        await wait(7700);
        observer.disconnect();
        const pixel = canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
        let opaque = 0;
        for(let i=3;i<pixel.length;i+=4) if(pixel[i]) opaque++;
        const continuous = { start, end:canvas.dataset.startedAt, samples, menuChecks, opaque, composerOpened,
          viewport:JSON.parse(canvas.dataset.viewport), width:canvas.width, height:canvas.height };
        await window.pet.setPreferences({disabledActions:['lounge','sway','ponder','wait','doze','wave']});
        await wait(350);
        const staticFrame = canvas.dataset.frame, staticStart=canvas.dataset.startedAt;
        await wait(350);
        const staticResult = { action:canvas.dataset.action, frame:canvas.dataset.frame,
          stable:staticFrame===canvas.dataset.frame && staticStart===canvas.dataset.startedAt };
        const rgba = canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
        const probe = async (opaque) => {
          let index=0;
          while(index<rgba.length/4 && (opaque ? rgba[index*4+3]<200 : rgba[index*4+3]!==0)) index++;
          const rect=canvas.getBoundingClientRect();
          canvas.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,
            clientX:rect.left+(index%canvas.width+.5)*rect.width/canvas.width,
            clientY:rect.top+(Math.floor(index/canvas.width)+.5)*rect.height/canvas.height}));
          await wait(50);
        };
        await probe(false); await probe(true); await probe(false);
        await window.pet.setPreferences({disabledActions:['lounge','sway','ponder','wait','wave']});
        for(let i=0;i<80 && canvas.dataset.action!=='doze';i++) await wait(50);
        const optIn = {action:canvas.dataset.action, preferences:(await window.pet.getState()).preferences};
        const saved = {initial, continuous, staticResult, optIn};
        return saved;
      })()`);
      assert.deepEqual(result.initial.preferences.disabledActions, [
        'sway',
        'ponder',
        'wait',
        'doze',
        'wave',
      ]);
      assert.equal(result.initial.preferences.animationDefaultsVersion, 1);
      assert.equal(result.initial.preferences.scale, 1.25);
      assert.equal(result.initial.preferences.alwaysOnTop, false);
      assert.deepEqual(result.continuous.menuChecks, [true, false, false, false, false, false]);
      assert.equal(result.continuous.start, result.continuous.end, 'Panels/status reset the clock');
      assert.ok(result.continuous.samples.every((s) => s.startedAt === result.continuous.start));
      const frames = result.continuous.samples.map((s) => s.frame);
      assert.equal(new Set(frames).size, 36, 'Missing animation frames');
      const seams = frames.filter((f, i) => i > 0 && frames[i - 1] === 35 && f === 0).length;
      assert.ok(seams >= 2, 'Need two complete 35-to-0 seams');
      assert.ok(result.continuous.opaque > 1000, 'Canvas is blank');
      assert.equal(result.continuous.composerOpened, true);
      assert.deepEqual(
        interactiveMessages.slice(-2),
        [true, false],
        'Alpha click-through hit test',
      );
      assert.deepEqual(result.staticResult, { action: 'lounge', frame: '0', stable: true });
      assert.equal(result.optIn.action, 'doze');
      const saved = JSON.parse(fs.readFileSync(path.join(profile, 'preferences.json'), 'utf8'));
      assert.deepEqual(saved.disabledActions, result.optIn.preferences.disabledActions);
      assert.equal(saved.animationDefaultsVersion, 1);
      await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
      });
      await new Promise((resolve) => setTimeout(resolve, 350));
      const still = await win.webContents.executeJavaScript(
        'document.querySelector("canvas.pet").dataset.frame',
      );
      await new Promise((resolve) => setTimeout(resolve, 350));
      assert.equal(
        await win.webContents.executeJavaScript(
          'document.querySelector("canvas.pet").dataset.frame',
        ),
        still,
      );
      assert.equal(still, '0');
      fs.mkdirSync(path.resolve('work'), { recursive: true });
      fs.writeFileSync(
        path.resolve('work/animation-verification.json'),
        JSON.stringify({ passed: true, seams, ...result }, null, 2),
      );
      console.log(
        'PASS real Electron: 36 decoded frames, two loop seams, no menu/status reset, migration, opt-in, static/reduced motion',
      );
      clearTimeout(timeout);
      app.quit();
    } catch (error) {
      console.error(error);
      clearTimeout(timeout);
      app.exit(1);
    }
  });
});
require(path.resolve(process.env.DAFEYU_SMOKE_MAIN || 'dist/main/index.cjs'));
