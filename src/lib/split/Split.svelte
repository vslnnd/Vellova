<script lang="ts">
  import { getCurrentWebview } from '@tauri-apps/api/webview';
  import { onMount } from 'svelte';
  import { ui } from '../app.svelte';
  import DropZone from '../rename/DropZone.svelte';
  import { undoLast } from '../shared/batches';
  import { data } from '../shared/state.svelte';
  import { lastUndoable } from '../shared/store';
  import { island, send } from '../shell/islandState.svelte';
  import type { Grid } from './engine/grid';
  import HeaderPicker from './HeaderPicker.svelte';
  import { addPaths, invalidate, pickFiles, pickFolder, plan, refresh, runBatch, session } from './session.svelte';
  import SplitPreview from './SplitPreview.svelte';
  import SplitSettings from './SplitSettings.svelte';

  let dragging = $state(false);
  let picker = $state({ open: false, file: '' });

  // the last grid read for each file: a re-read clears session.reads, and the screen keeps showing the old grid until the new one lands
  const memo = new Map<string, Grid>();
  const grids = $derived.by(() => {
    const out: Record<string, Grid> = {};
    for (const f of session.files) {
      const r = session.reads[f.path];
      if (r?.ok) memo.set(f.path, r.grid);
      else if (r) memo.delete(f.path);
      const g = memo.get(f.path);
      if (g) out[f.path] = g;
    }
    return out;
  });

  const outputs = $derived(plan.items.filter((i) => i.op && i.status !== 'attention'));
  const sources = $derived(new Set(outputs.map((i) => i.source)).size);
  const attention = $derived(plan.items.filter((i) => i.status === 'attention').length);

  // re-read 150 ms after the files, sheet, header, mode or column change; the folder too, since it is listed for taken names
  // (with subfolders on, the rules that name them as well); other rules only re-plan
  $effect(() => {
    const r = session.rules;
    JSON.stringify([session.files, r.sheet, r.header, r.mode, r.column, session.columnFor, r.folder, r.subfolder && [r.params, r.people, r.nonMatching, r.peopleOutput, r.assign]]);
    invalidate();
    const t = setTimeout(() => void refresh(), 150);
    return () => clearTimeout(t);
  });

  // after a batch, the island's attention count follows the fixes made here
  $effect(() => {
    const n = attention;
    if (!session.loading && !session.dirty && island.attention && island.attention !== n) send({ type: 'attention', count: n });
  });

  onMount(() => {
    const off = getCurrentWebview().onDragDropEvent(({ payload: p }) => {
      if (ui.tool !== 'split' || ui.panel) return;
      if (p.type === 'enter' || p.type === 'over') dragging = true;
      else if (p.type === 'leave') dragging = false;
      else {
        dragging = false;
        void addPaths(p.paths);
      }
    });
    return () => void off.then((f) => f());
  });

  /** Switches the header to Manual (keeping a manual row) and opens the picker on `file`. */
  function choose(file = session.files[0]?.path ?? '') {
    if (session.rules.header.mode !== 'manual') session.rules.header = { mode: 'manual', row: 1 };
    picker = { open: true, file };
  }
</script>

<section class="split">
  <header>
    <h1>Split</h1>
    <p class="hint">Rules on the left, every output file previewed on the right.</p>
  </header>
  <div class="cols">
    <SplitSettings {grids} onpick={choose} />
    <div class="right">
      {#if session.files.length}
        <SplitPreview {grids} onpick={choose} />
      {:else}
        <DropZone title="Drop .xlsx, .xls or .csv files" accept="" onfiles={pickFiles} onfolder={pickFolder} recursive={false} />
      {/if}
    </div>
  </div>
  <footer>
    <span class="count">
      {#if session.files.length}{outputs.length} {outputs.length === 1 ? 'file' : 'files'} will be created{:else}No files yet{/if}
    </span>
    {#if attention}
      <button class="attn" onclick={() => (ui.panel = 'attention')}>{attention} {attention === 1 ? 'needs' : 'need'} attention</button>
    {/if}
    <span class="grow"></span>
    <button class="btn" disabled={!lastUndoable(data.history) || !!island.activity} onclick={() => void undoLast()}>Undo last batch</button>
    <button class="btn primary" disabled={!outputs.length || session.loading || session.dirty || session.busy || !!island.activity} onclick={() => void runBatch()}>
      Split {sources} {sources === 1 ? 'file' : 'files'}
    </button>
  </footer>
  {#if dragging}<div class="drop" aria-hidden="true">Drop to add</div>{/if}
  <HeaderPicker bind:open={picker.open} bind:file={picker.file} {grids} />
</section>

<style>
  .split { height: 100%; display: flex; flex-direction: column; gap: 14px; }
  h1 { font-size: 22px; }
  .cols { flex: 1; min-height: 0; display: flex; gap: 16px; }
  .right { flex: 1 1 420px; min-width: 0; display: flex; flex-direction: column; }
  footer { display: flex; align-items: center; gap: 10px; padding: 12px 0 16px; border-top: 1px solid var(--border); }
  .count { font-size: 13px; color: var(--text2); font-variant-numeric: tabular-nums; }
  .attn { height: 24px; padding: 0 10px; border: 0; border-radius: 999px; background: var(--warnsoft); color: var(--warn); font-size: 12px; font-weight: 600; }
  .grow { flex: 1; }
  .drop {
    position: fixed; inset: 72px 12px 12px; display: grid; place-items: center; pointer-events: none;
    border: 2px dashed var(--accent); border-radius: 12px; background: var(--soft); color: var(--accent); font-weight: 600;
  }
</style>
