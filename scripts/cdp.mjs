// Dev helper: talk to the running app's WebView2 over the DevTools protocol.
// Start the app with:  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 npm run tauri dev
// Then:  node scripts/cdp.mjs eval "document.title"   |   node scripts/cdp.mjs shot shot.png
import { writeFileSync } from 'node:fs';

const [cmd, arg] = process.argv.slice(2);
const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const page = list.find((t) => t.type === 'page');
if (!page) throw new Error('No page target. Is the app running with the debug port?');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve) => (ws.onopen = resolve));
let id = 0;
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const mine = ++id;
    ws.addEventListener('message', function on(e) {
      const m = JSON.parse(e.data);
      if (m.id === mine) {
        ws.removeEventListener('message', on);
        resolve(m.result);
      }
    });
    ws.send(JSON.stringify({ id: mine, method, params }));
  });

if (cmd === 'eval') {
  const r = await send('Runtime.evaluate', { expression: arg, awaitPromise: true, returnByValue: true });
  console.log(JSON.stringify(r.exceptionDetails ? r.exceptionDetails.text : r.result.value, null, 2));
} else if (cmd === 'shot') {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(arg ?? 'shot.png', Buffer.from(r.data, 'base64'));
  console.log('saved', arg ?? 'shot.png');
} else {
  console.log('usage: node scripts/cdp.mjs eval "<js>" | shot <file.png>');
}
ws.close();
