// 在真实 Electron 中重放窗口销毁后排队到达的 IPC，禁止错误弹窗干扰用户。
const { app, ipcMain } = require('electron');
const path = require('node:path');
const assert = require('node:assert/strict');
process.env.PET_TEST_PROFILE = 'lifecycle-' + process.pid;
const timeout = setTimeout(() => app.exit(1), 15000);
process.on('uncaughtException', (error) => {
  console.error(error);
  app.exit(1);
});
app.on('browser-window-created', (_event, win) => {
  win.webContents.once('did-finish-load', async () => {
    try {
      const sender = win.webContents;
      // 首屏加载完成后关闭窗口；鼠标穿透、布局等旧事件仍可能在主进程队列里。
      await sender.executeJavaScript('window.pet.getState()');
      win.destroy();
      const failures = [];
      for (const [channel, ...args] of [
        ['pet:interactive', true],
        ['pet:layout', { panel: null, bubble: null }],
        ['pet:move', 1, 1],
        ['pet:scale', 1.1],
        ['pet:quit'],
      ]) {
        try {
          ipcMain.emit(channel, { sender }, ...args);
        } catch (error) {
          failures.push(`${channel}: ${error.message}`);
        }
      }
      assert.deepEqual(failures, []);
      app.emit('second-instance');
      console.log(
        'PASS destroyed window: late interactive/layout/move/scale/quit IPC and second instance',
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
