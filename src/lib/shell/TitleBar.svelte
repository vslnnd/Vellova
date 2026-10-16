<script lang="ts">
  import { onMount } from 'svelte';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { flush } from '../shared/state.svelte';
  import Island from './Island.svelte';

  let { oncancel, onundo, onrestart }: { oncancel: () => void; onundo: () => void; onrestart: () => void } = $props();
  const win = getCurrentWindow();

  // Every way of closing (button, Alt+F4, taskbar) saves pending changes first.
  onMount(() => {
    const off = win.onCloseRequested(async (e) => {
      e.preventDefault();
      await flush();
      await win.destroy();
    });
    return () => void off.then((f) => f());
  });
</script>

<header class="bar" data-tauri-drag-region>
  <div class="brand" data-tauri-drag-region>
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 6l7 12 7-12" /></svg>
    <span data-tauri-drag-region>Vellova</span>
  </div>
  <Island {oncancel} {onundo} {onrestart} />
  <div class="win">
    <button class="wb" aria-label="Minimize" onclick={() => win.minimize()}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M5 12h14" /></svg>
    </button>
    <button class="wb" aria-label="Maximize" onclick={() => win.toggleMaximize()}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="1" /></svg>
    </button>
    <button class="wb close" aria-label="Close" onclick={() => win.close()}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
    </button>
  </div>
</header>

<style>
  .bar { height: 60px; display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; background: var(--chrome); border-bottom: 1px solid var(--border); }
  .brand { display: flex; align-items: center; gap: 10px; padding-left: 18px; font-weight: 600; letter-spacing: -0.01em; }
  .win { justify-self: end; display: flex; height: 100%; }
  .wb { width: 46px; height: 60px; border: 0; background: transparent; color: var(--text3); display: inline-flex; align-items: center; justify-content: center; transition: background 160ms ease, color 160ms ease; }
  .wb:hover { background: var(--hover); color: var(--text); }
  .wb.close:hover { background: #C42B1C; color: #FFFFFF; }
</style>
