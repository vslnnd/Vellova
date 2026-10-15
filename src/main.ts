import { mount } from 'svelte';
import { getCurrentWindow } from '@tauri-apps/api/window';
import App from './App.svelte';

mount(App, { target: document.getElementById('app')! });
void getCurrentWindow().show();
