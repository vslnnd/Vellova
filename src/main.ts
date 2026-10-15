import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './app.css';
import { mount } from 'svelte';
import { getCurrentWindow } from '@tauri-apps/api/window';
import App from './App.svelte';
import { setTheme } from './lib/app.svelte';
import { watchSystemTheme } from './lib/shell/theme';

setTheme('system');
watchSystemTheme(() => setTheme('system'));
mount(App, { target: document.getElementById('app')! });
void getCurrentWindow().show();
