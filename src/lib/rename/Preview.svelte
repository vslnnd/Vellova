<script lang="ts">
  import { extOf, splitExt, splitPath } from '../shared/names';
  import type { PlanItem, Status } from '../shared/types';
  import { clearFiles, pickFiles, pickFolder, plan, refresh, removeFile, session, setName, skip } from './session.svelte';
  import { tourRow } from '../tour/tour.svelte';

  const PILL: Record<Status, [string, string]> = {
    ready: ['ok', 'Ready'],
    paired: ['ok', 'Paired'],
    duplicate: ['warn', 'Duplicate'],
    unchanged: ['muted', 'Unchanged'],
    attention: ['err', 'Attention'],
    skipped: ['muted', 'Skipped'],
    pending: ['muted', 'Waiting'],
  };
  const nameOf = (p: string) => splitPath(p).name;
  const shownName = (it: PlanItem) => session.overrides[it.source] ?? (it.name ? splitExt(it.name).base : '');
</script>

<div class="card preview">
  <div class="row head">
    <h3>{session.files.length} {session.files.length === 1 ? 'file' : 'files'}</h3>
    {#if session.loading}
      <span class="hint">reading…</span>
    {:else if session.dirty}
      <span class="hint">Not fully read</span>
      <button class="btn small" onclick={() => void refresh()}>Read again</button>
    {/if}
    <span class="grow"></span>
    <button class="btn small" onclick={() => void pickFiles()}>Add files</button>
    <button class="btn small" onclick={() => void pickFolder()}>Add folder</button>
    <button class="btn small" onclick={clearFiles}>Clear</button>
  </div>
  {#if !session.rules.keyword.trim()}
    <p class="hint banner">Type the keyword that comes before the value to see the new names.</p>
  {/if}
  <ul data-tour="preview">
    {#each plan.items as it (it.id)}
      {@const [tone, label] = PILL[it.status]}
      <li class:dim={it.status === 'skipped' || it.status === 'unchanged'} data-tour={tourRow(it.source)}>
        <span class="from mono" title={it.source}>{nameOf(it.source)}</span>
        <span class="to">
          <input
            class="mono"
            spellcheck="false"
            aria-label="New name for {nameOf(it.source)}"
            placeholder="Type a name"
            value={shownName(it)}
            disabled={it.status === 'skipped'}
            onchange={(e) => setName(it.source, e.currentTarget.value)}
          />
          <span class="ext mono">{extOf(it.source)}</span>
        </span>
        <span class="pill {tone}">{label}</span>
        <button class="ib" title={it.status === 'skipped' ? 'Include' : 'Skip'} aria-label="{it.status === 'skipped' ? 'Include' : 'Skip'} {nameOf(it.source)}" onclick={() => skip(it.source)}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M5.6 5.6l12.8 12.8" /></svg>
        </button>
        <button class="ib" title="Remove from the list" aria-label="Remove {nameOf(it.source)}" onclick={() => removeFile(it.source)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
        {#if it.detail && it.status !== 'ready'}<span class="why">{it.detail}</span>{/if}
      </li>
    {/each}
  </ul>
</div>

<style>
  .preview { flex: 1; min-height: 0; padding: 0; gap: 0; }
  .head { padding: 12px 14px; border-bottom: 1px solid var(--border); }
  .banner { padding: 10px 14px 0; }
  .grow { flex: 1; }
  ul { list-style: none; margin: 0; padding: 4px 0; overflow: auto; flex: 1; }
  li { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.3fr) auto auto auto; align-items: center; gap: 8px; padding: 3px 8px 3px 14px; }
  li:hover { background: var(--hover); }
  li.dim { opacity: 0.65; }
  .from { font-size: 12.5px; color: var(--text2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .to { display: flex; align-items: center; min-width: 0; }
  .to input { flex: 1; min-width: 0; height: 28px; padding: 0 6px; border: 1px solid transparent; border-radius: 6px; background: transparent; font-size: 12.5px; }
  .to input:hover { border-color: var(--border); }
  .to input:focus { border-color: var(--accent); outline: none; background: var(--bg); }
  .ext { font-size: 12.5px; color: var(--text3); }
  .why { grid-column: 1 / -1; font-size: 12px; color: var(--text3); }
  .ib { width: 28px; height: 28px; }
</style>
