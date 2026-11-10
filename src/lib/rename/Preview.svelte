<script lang="ts">
  import { extOf, splitExt, splitPath } from '../shared/names';
  import { REASONS } from '../shared/reasons';
  import type { PlanItem, Status } from '../shared/types';
  import { clearFiles, pickFiles, pickFolder, plan, refresh, removeFile, session, setName, skip } from './session.svelte';
  import { byName } from './engine/steps';
  import { tourRow } from '../tour/tour.svelte';

  const PILL: Record<Status, [string, string]> = {
    ready: ['ok', 'Ready'],
    paired: ['ok', 'Paired'],
    duplicate: ['warn', 'Duplicate'],
    unchanged: ['muted', 'Unchanged'],
    attention: ['warn', 'Attention'],
    skipped: ['muted', 'Skipped'],
    pending: ['muted', 'Waiting'],
  };
  const nameOf = (p: string) => splitPath(p).name;
  /** the extension the new name will have: lower-cased from PDF text (as always), as written when renaming by file name */
  const extShown = (p: string) => (byName(session.rules.steps) ? splitExt(nameOf(p)).ext : extOf(p));
  const shownName = (it: PlanItem) => session.overrides[it.source] ?? (it.name ? splitExt(it.name).base : '');
  /** A file that needs attention says why on its pill; the full sentence is its tooltip and in Needs attention. */
  const pillText = (it: PlanItem) => (it.status === 'attention' && it.reason ? REASONS[it.reason].title : PILL[it.status][1]);
  /** What every waiting file waits for, said once above the list instead of under each row. */
  const waiting = $derived.by(() => {
    const p = plan.items.filter((i) => i.status === 'pending' && i.detail);
    return p.length && p.every((i) => i.detail === p[0].detail) ? p[0].detail! : '';
  });
</script>

<div class="card preview">
  <div class="row head">
    <h3>{session.files.length} {session.files.length === 1 ? 'file' : 'files'}</h3>
    {#if session.loading}
      <span class="status" role="status">Reading…</span>
    {:else if session.dirty}
      <span class="status" role="status">Not fully read</span>
      <button class="btn small" onclick={() => void refresh()}>Read again</button>
    {:else if waiting}
      <span class="status" role="status">{waiting}</span>
    {/if}
    <span class="grow"></span>
    <button class="btn small" onclick={() => void pickFiles()}>Add files</button>
    <button class="btn small" onclick={() => void pickFolder()}>Add folder</button>
    <button class="btn small" onclick={clearFiles}>Clear</button>
  </div>
  <div class="cols" aria-hidden="true"><span>Now</span><span>New name</span></div>
  <ul data-tour="preview">
    {#each plan.items as it (it.id)}
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
          <span class="ext mono">{extShown(it.source)}</span>
        </span>
        <span class="end">
        <span class="acts">
          <button class="ib" title={it.status === 'skipped' ? 'Include' : 'Skip'} aria-label="{it.status === 'skipped' ? 'Include' : 'Skip'} {nameOf(it.source)}" onclick={() => skip(it.source)}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M5.6 5.6l12.8 12.8" /></svg>
          </button>
          <button class="ib" title="Remove from the list" aria-label="Remove {nameOf(it.source)}" onclick={() => removeFile(it.source)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </span>
        <span class="pill {PILL[it.status][0]}" title={it.status === 'ready' ? undefined : it.detail}>{pillText(it)}</span>
        </span>
      </li>
    {/each}
  </ul>
</div>

<style>
  .preview { flex: 1; min-height: 0; padding: 0; gap: 0; }
  .head { padding: 10px 14px; border-bottom: 1px solid var(--border); }
  .status { font-size: 12.5px; color: var(--text2); }
  .grow { flex: 1; }
  /* three shares of the width, the same in every row, so the names line up */
  .cols, li { display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 3.4fr) minmax(0, 4.6fr); align-items: center; gap: 8px; padding: 0 12px 0 14px; }
  .end { display: flex; align-items: center; justify-content: flex-end; gap: 4px; min-width: 0; }
  .end .pill { display: block; line-height: 20px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cols { padding-top: 8px; padding-bottom: 2px; font-size: 12px; color: var(--text3); }
  .cols span:nth-child(2) { padding-left: 7px; }
  ul { list-style: none; margin: 0; padding: 2px 0 4px; overflow: auto; flex: 1; }
  li { min-height: 34px; }
  li:hover { background: var(--hover); }
  li.dim { opacity: 0.65; }
  .from { font-size: 12.5px; color: var(--text2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* the extension sits right after the name: the field is as wide as what is in it */
  .to { display: flex; align-items: center; min-width: 0; }
  .to input { field-sizing: content; min-width: 28px; max-width: calc(100% - 48px); height: 28px; padding: 0 6px; border: 1px solid transparent; border-radius: 6px; background: transparent; font-size: 12.5px; font-weight: 500; }
  .to input:placeholder-shown { border-color: var(--border2); background: var(--bg); font-weight: 400; }
  .to input:hover { border-color: var(--border); }
  .to input:focus { border-color: var(--accent); outline: none; background: var(--bg); }
  .ext { font-size: 12.5px; color: var(--text3); }
  /* skip and remove show for the row that is pointed at or holds the focus */
  .acts { display: flex; flex: none; opacity: 0; }
  li:hover .acts, li:focus-within .acts { opacity: 1; }
  .ib { width: 28px; height: 28px; }
</style>
