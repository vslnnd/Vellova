import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './app.css';
import { mount } from 'svelte';
import { getCurrentWindow } from '@tauri-apps/api/window';
import App from './App.svelte';
import { setTheme } from './lib/app.svelte';
import { watchSystemTheme } from './lib/shell/theme';
import { data, loadAll, log } from './lib/shared/state.svelte';

setTheme('system');
loadAll()
  .catch((e) => log({ level: 'error', tool: 'app', message: 'Saved data could not be loaded; using defaults.', detail: String(e) }))
  .finally(() => {
    setTheme(data.settings.theme);
    watchSystemTheme(() => setTheme(data.settings.theme));
    mount(App, { target: document.getElementById('app')! });
    void getCurrentWindow().show();
  });
