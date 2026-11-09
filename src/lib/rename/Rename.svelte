<script lang="ts">
  import { getCurrentWebview } from '@tauri-apps/api/webview';
  import { onMount } from 'svelte';
  import { ui } from '../app.svelte';
  import ProfileBar from '../shared/ProfileBar.svelte';
  import { data } from '../shared/state.svelte';
  import { island, send } from '../shell/islandState.svelte';
  import DropZone from './DropZone.svelte';
  import { summary } from './engine/planner';
  import PdfPicker from './PdfPicker.svelte';
  import Preview from './Preview.svelte';
  import RenameBar from './RenameBar.svelte';
  import RenameSettings from './RenameSettings.svelte';
  import { addPaths, invalidate, pickProfile, plan, refresh, runBatch, saveProfile, session } from './session.svelte';

  let dragging = $state(false);
  const sum = $derived(summary(plan.items, session.rules.destination));

  // re-read 150 ms after the files or the rules change (every step can change a name); conflicts only re-plan
  $effect(() => {
    const r = session.rules;
    JSON.stringify([session.files, r.steps, r.pair, r.destination]);
    invalidate(); // at once: Rename waits for the new values, not the old ones
    const t = setTimeout(() => void refresh(), 150);
    return () => clearTimeout(t);
  });

  // after a batch of this tool, the island's attention count follows the fixes made here (not mid-read, when rows are only waiting)
  $effect(() => {
    const n = sum.attention;
    if (island.attentionTool === 'rename' && !session.loading && !session.dirty && island.attention && island.attention !== n) send({ type: 'attention', count: n });
  });

  // the picker shows a file of the list: no files, no picker
  $effect(() => {
    if (!session.files.length) session.picking = null;
  });

  onMount(() => {
    const off = getCurrentWebview().onDragDropEvent(({ payload: p }) => {
      if (ui.tool !== 'rename' || ui.panel) return;
      if (p.type === 'enter' || p.type === 'over') dragging = true;
      else if (p.type === 'leave') dragging = false;
      else {
        dragging = false;
        void addPaths(p.paths);
      }
    });
    return () => void off.then((f) => f());
  });
</script>

<section class="rename">
  {#if !session.files.length}
    <!-- no files yet: only where they go, and the profile to use on them -->
    <DropZone tour="drop">
      <ProfileBar id="rn-profile" tour="profile" profiles={data.profiles.rename} current={session.profileId} onpick={pickProfile} onsave={saveProfile} />
    </DropZone>
  {:else}
    <RenameBar />
    <div class="cols">
      {#if session.picking}
        <PdfPicker />
      {:else}
        <RenameSettings />
        <div class="right"><Preview /></div>
      {/if}
    </div>
    <footer>
      {#if sum.attention}
        <button class="attn" onclick={() => (ui.panel = 'attention')}>{sum.attention} {sum.attention === 1 ? 'needs' : 'need'} attention</button>
      {/if}
      <span class="grow"></span>
      <button class="btn primary" data-tour="apply" disabled={!sum.ops || session.loading || session.dirty || session.busy || !!island.activity} onclick={() => void runBatch()}>{sum.label}</button>
    </footer>
  {/if}
  {#if dragging}<div class="drop" aria-hidden="true">Drop to add</div>{/if}
</section>

<style>
  .rename { height: 100%; display: flex; flex-direction: column; gap: 14px; }
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
