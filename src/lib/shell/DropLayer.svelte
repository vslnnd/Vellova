<script lang="ts">
  import { getCurrentWebview } from '@tauri-apps/api/webview';
  import { onMount } from 'svelte';
  import { ui, type Tool } from '../app.svelte';
  import { addPaths as addRename, session as rename } from '../rename/session.svelte';
  import { addPaths as addSplit, session as split } from '../split/session.svelte';
  import { tourActive } from '../tour/tour.svelte';
  import { dropTool } from './drop';

  /** the tool the dragged files are over; null: nothing is being dragged in */
  let over = $state<Tool | null>(null);
  // two zones while the tool on screen has nothing in its list (not in the tour, whose samples belong to Rename)
  const zones = $derived(!(ui.tool === 'rename' ? rename : split).files.length && !tourActive());
  const NAME = { rename: 'Rename', split: 'Split' };

  /** `x`: where the files are, in CSS pixels from the window's left edge */
  function drag(type: 'over' | 'leave' | 'drop', x = 0, paths: string[] = []) {
    if (ui.panel) return;
    if (type === 'leave') return void (over = null);
    const tool = dropTool(x, innerWidth, ui.tool, zones);
    if (type === 'over') return void (over = tool);
    over = null;
    ui.tool = tool;
    void (tool === 'split' ? addSplit : addRename)(paths);
  }

  onMount(() => {
    const off = getCurrentWebview().onDragDropEvent(({ payload: p }) => {
      if (p.type === 'leave') drag('leave');
      else drag(p.type === 'drop' ? 'drop' : 'over', p.position.x / devicePixelRatio, p.type === 'over' ? [] : p.paths);
    });
    return () => void off.then((f) => f());
  });

  // dev only: lets scripts/cdp.mjs show the drop zones (`__drag('over', 300)`)
  if (import.meta.env.DEV) Object.assign(window, { __drag: drag });
</script>

{#if over}
  <div class="layer" aria-hidden="true">
    {#each zones ? (['rename', 'split'] as const) : [over] as t (t)}
      <div class="zone" class:on={over === t}>
        {#if t === 'rename'}
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7V5h16v2" /><path d="M12 5v14" /><path d="M9 19h6" /></svg>
        {:else}
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><rect x="3" y="4" width="7" height="16" rx="1.5" /><rect x="14" y="4" width="7" height="16" rx="1.5" /></svg>
        {/if}
        <span>{NAME[t]}</span>
      </div>
    {/each}
  </div>
{/if}

<style>
  /* covers the screen under the title bar, so nothing shows through the zones */
  .layer { position: fixed; inset: 60px 0 0 0; z-index: 900; display: flex; gap: 12px; padding: 12px; background: var(--bg); pointer-events: none; }
  .zone {
    flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px;
    border: 2px dashed var(--border2); border-radius: 12px; background: var(--surface); color: var(--text3);
    font-size: 20px; font-weight: 600; transition: background 140ms ease, border-color 140ms ease, color 140ms ease;
  }
  .zone.on { border-color: var(--accent); background: var(--soft); color: var(--accent); }
</style>
