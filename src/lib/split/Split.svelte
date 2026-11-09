<script lang="ts">
  import { getCurrentWebview } from '@tauri-apps/api/webview';
  import { onMount } from 'svelte';
  import { ui } from '../app.svelte';
  import DropZone from '../rename/DropZone.svelte';
  import ProfileBar from '../shared/ProfileBar.svelte';
  import { data } from '../shared/state.svelte';
  import { island, send } from '../shell/islandState.svelte';
  import type { Grid } from './engine/grid';
  import HeaderPicker from './HeaderPicker.svelte';
  import SplitBar from './SplitBar.svelte';
  import { addPaths, invalidate, pickFiles, pickFolder, pickProfile, plan, refresh, runBatch, saveProfile, session } from './session.svelte';
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
    for (const p of memo.keys()) if (!session.files.some((f) => f.path === p)) memo.delete(p);
    return out;
  });

  const outputs = $derived(plan.items.filter((i) => i.op && i.status !== 'attention'));
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
    if (island.attentionTool === 'split' && !session.loading && !session.dirty && island.attention && island.attention !== n) send({ type: 'attention', count: n });
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
  {#if !session.files.length}
    <!-- no files yet: only where they go, and the profile to use on them -->
    <DropZone title="Drop .xlsx, .xls or .csv files" onfiles={pickFiles} onfolder={pickFolder}>
      <ProfileBar id="sp-profile" profiles={data.profiles.split} current={session.profileId} onpick={pickProfile} onsave={saveProfile} />
    </DropZone>
  {:else}
    <SplitBar {grids} onpick={choose} />
    <div class="cols">
      <SplitSettings {grids} />
      <div class="right"><SplitPreview {grids} onpick={choose} /></div>
    </div>
    <footer>
      {#if attention}
        <button class="attn" onclick={() => (ui.panel = 'attention')}>{attention} {attention === 1 ? 'needs' : 'need'} attention</button>
      {/if}
      <span class="grow"></span>
      <button class="btn primary" disabled={!outputs.length || session.loading || session.dirty || session.busy || !!island.activity} onclick={() => void runBatch()}>
        Create {outputs.length} {outputs.length === 1 ? 'file' : 'files'}
      </button>
    </footer>
  {/if}
  {#if dragging}<div class="drop" aria-hidden="true">Drop to add</div>{/if}
  <HeaderPicker bind:open={picker.open} bind:file={picker.file} {grids} />
</section>

<style>
  .split { height: 100%; display: flex; flex-direction: column; gap: 14px; }
  .cols { flex: 1; min-height: 0; display: flex; gap: 16px; }
  .right { flex: 1 1 420px; min-width: 0; display: flex; flex-direction: column; }
  footer { display: flex; align-items: center; gap: 10px; padding: 12px 0 16px; border-top: 1px solid var(--border); }
  .attn { height: 24px; padding: 0 10px; border: 0; border-radius: 999px; background: var(--warnsoft); color: var(--warn); font-size: 12px; font-weight: 600; }
  .grow { flex: 1; }
  .drop {
    position: fixed; inset: 72px 12px 12px; display: grid; place-items: center; pointer-events: none;
    border: 2px dashed var(--accent); border-radius: 12px; background: var(--soft); color: var(--accent); font-weight: 600;
  }
</style>
