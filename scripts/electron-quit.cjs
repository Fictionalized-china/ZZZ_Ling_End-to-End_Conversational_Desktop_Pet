// Parent test owns the second client; this process loads and quits the real app.
const { app } = require('electron');
const path = require('node:path');
process.env.PET_TEST_PROFILE = 'quit-' + process.pid;
const timer = setTimeout(() => app.exit(1), 25000);
app.on('will-quit', () => clearTimeout(timer));
app.on('browser-window-created', (_event, win) => {
  win.webContents.once('did-finish-load', async () => {
    try {
      await win.webContents.executeJavaScript('window.pet.createPair()');
      for (let i = 0; i < 150; i++) {
        const state = await win.webContents.executeJavaScript('window.pet.getState()');
        if (state.code && state.connection === 'connected') {
          process.stdout.write(JSON.stringify({ testPairCode: state.code }) + '\n');
          for (let attempt = 0; attempt < 150; attempt++) {
            const next = await win.webContents.executeJavaScript('window.pet.getState()');
            if (next.messages.some((message) => message.text === 'quit-regression-trigger')) {
              await win.webContents.executeJavaScript('window.pet.quit()');
              return;
            }
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          throw Error('Quit trigger not received');
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw Error('Test app failed to connect');
    } catch (error) {
      console.error(error.message);
      app.exit(1);
    }
  });
});
require(path.resolve(process.env.DAFEYU_SMOKE_MAIN || 'dist/main/index.cjs'));
