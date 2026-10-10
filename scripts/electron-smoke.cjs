// 用真实 Electron 运行生产构建，检查 preload、IPC 和首屏渲染。
const { app } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const assert = require('node:assert/strict');
process.env.PET_TEST_PROFILE = 'smoke-' + process.pid;
const timeout = setTimeout(() => {
  console.error('Electron startup timed out');
  app.exit(1);
}, 20000);
app.on('browser-window-created', (_event, win) => {
  win.webContents.on('preload-error', (_event, _preload, error) => {
    console.error(error.message);
    app.exit(1);
  });
  win.webContents.once('did-finish-load', async () => {
    try {
      let result;
      for (let attempt = 0; attempt < 50; attempt++) {
        result = await win.webContents.executeJavaScript(
          '(async()=>({state:await window.pet.getState(),text:document.body.innerText,images:[...document.images].map(i=>({ready:i.complete,width:i.naturalWidth})),animation:(()=>{const c=document.querySelector("canvas.pet");return c?{ready:c.dataset.ready,width:c.width,height:c.height,action:c.dataset.action}:null})()}))()',
        );
        if (
          result.text.includes('菜单') &&
          result.animation?.ready === 'true' &&
          result.images.every((image) => image.ready && image.width > 0)
        )
          break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.equal(result.state.effective, 'offline');
      assert.equal(win.getTitle(), '铃宝');
      assert.equal(result.state.paired, false);
      if (process.env.DAFEYU_EXPECT_RELAY_URL)
        assert.equal(result.state.preferences.relayUrl, process.env.DAFEYU_EXPECT_RELAY_URL);
      assert.ok(result.text.includes('菜单') && !result.text.includes('调整大小'));
      assert.equal(
        await win.webContents.executeJavaScript(
          '!!document.querySelector(".quick-composer textarea") && !!document.querySelector(".resize-handle") && document.querySelector(".presence").getAttribute("aria-label")==="自己的状态：在线"',
        ),
        true,
      );
      assert.ok(
        result.animation?.ready === 'true' &&
          result.animation.width > 0 &&
          result.images.every((image) => image.ready && image.width > 0),
      );
      assert.equal(result.animation.action, 'lounge');
      assert.equal(result.state.preferences.disabledActions.length, 5);
      const image = await win.webContents.capturePage();
      await fs.mkdir(path.resolve('work'), { recursive: true });
      await fs.writeFile(path.resolve('work/electron-startup.png'), image.toPNG());
      await fs.writeFile(
        path.resolve('work/electron-smoke.json'),
        JSON.stringify(
          {
            passed: true,
            title: win.getTitle(),
            effective: result.state.effective,
            paired: result.state.paired,
            relayUrl: result.state.preferences.relayUrl,
            images: result.images,
            animation: result.animation,
            window: win.getBounds(),
            electron: process.versions.electron,
          },
          null,
          2,
        ),
      );
      console.log('PASS real Electron startup, isolated preload, IPC and first render');
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
