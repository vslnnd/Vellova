import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './app.css';
import { mount } from 'svelte';
import { getCurrentWindow } from '@tauri-apps/api/window';
import App from './App.svelte';
import { setTheme } from './lib/app.svelte';
import { watchSystemTheme } from './lib/shell/theme';
import { data, loadAll, log } from './lib/shared/state.svelte';
import { ipc } from './lib/shared/ipc';

setTheme('system');
loadAll()
  .catch((e) => log({ level: 'error', tool: 'app', message: 'Saved data could not be loaded; using defaults.', detail: String(e) }))
  .finally(() => {
    setTheme(data.settings.theme);
    watchSystemTheme(() => setTheme(data.settings.theme));
    mount(App, { target: document.getElementById('app')! });
    void getCurrentWindow().show();
    void ipc.recoverAll().then((r) => {
      if (r.restored) log({ level: 'warn', tool: 'app', message: `${r.restored} file(s) left under a temporary name by an interrupted batch got their name back.` });
      for (const s of r.skipped) log({ level: 'error', tool: 'app', file: s.path, message: 'An interrupted batch left this file behind.', detail: s.reason });
    }).catch((e) => log({ level: 'error', tool: 'app', message: 'Recovery could not run.', detail: String(e) }));
  });
