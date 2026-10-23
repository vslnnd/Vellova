<script lang="ts">
  import { data, save } from '../shared/state.svelte';
  import ProfileBar from '../shared/ProfileBar.svelte';
  import type { Conflict, SplitMode, SplitRules } from '../shared/types';
  import { island } from '../shell/islandState.svelte';
  import type { Grid } from './engine/grid';
  import { pickOutputFolder, reset, saveProfile, session, useProfile } from './session.svelte';

  let { grids, onpick }: { grids: Record<string, Grid>; onpick: () => void } = $props();

  const MODES: [SplitMode, string][] = [['value', 'Value'], ['people', 'People'], ['rows', 'Rows'], ['parts', 'Parts'], ['sheets', 'Sheets']];
  const FORMATS: [SplitRules['format'], string][] = [['same', 'Same type'], ['xlsx', '.xlsx'], ['csv', '.csv']];
  const CONFLICTS: [Conflict, string, string][] = [['add', 'Add (1)', 'add (1)'], ['skip', 'Skip', 'skip'], ['replace', 'Replace (Recycle Bin)', 'replace']];

  const rules = $derived(session.rules);
  const first = $derived(grids[session.files[0]?.path ?? '']);
  const favourites = $derived(data.settings.split.favourites);
  const folderPath = $derived(rules.folder.mode === 'folder' ? rules.folder.path : '');
  const starred = $derived(!!folderPath && favourites.includes(folderPath));

  function pick(id: string | null) {
    const p = data.profiles.split.find((x) => x.id === id);
    if (p) useProfile(p);
    else session.profileId = null;
  }

  function setFolder(v: string) {
    if (v === 'source') session.rules.folder = { mode: 'source' };
    else if (v.startsWith('f:')) session.rules.folder = { mode: 'folder', path: v.slice(2) };
  }
  function star() {
    if (!folderPath) return;
    data.settings.split.favourites = starred ? favourites.filter((f) => f !== folderPath) : [...favourites, folderPath];
    save('settings');
  }
</script>

<div class="card bar">
  <ProfileBar id="sp-profile" profiles={data.profiles.split} current={session.profileId} onpick={pick} onsave={saveProfile} />
  <span class="vr"></span>
  <div class="grp">
    <span class="label" id="sp-mode">Split by</span>
    <div class="seg" role="group" aria-labelledby="sp-mode">
      {#each MODES as [v, label] (v)}
        <button data-part={rules.mode === v ? 'mode' : undefined} aria-pressed={rules.mode === v} onclick={() => (session.rules.mode = v)}>{label}</button>
      {/each}
    </div>
  </div>
  {#if first && first.sheets.length > 1 && rules.mode !== 'sheets'}
    <span class="vr"></span>
    <div class="grp">
      <label class="label" for="sp-sheet">Sheet</label>
      <select id="sp-sheet" class="dd" value={rules.sheet ?? first.sheets[0].name} onchange={(e) => (session.rules.sheet = e.currentTarget.value === first.sheets[0].name ? null : e.currentTarget.value)}>
        {#each first.sheets as s (s.name)}<option value={s.name}>{s.name}</option>{/each}
      </select>
    </div>
  {/if}
  {#if rules.mode !== 'sheets'}
    <span class="vr"></span>
    <div class="grp">
      <span class="label" id="sp-head">Header</span>
      <div class="seg" role="group" aria-labelledby="sp-head">
        <button data-part={rules.header.mode === 'default' ? 'header' : undefined} aria-pressed={rules.header.mode === 'default'} onclick={() => (session.rules.header = { mode: 'default' })}>Row 1</button>
        <button data-part={rules.header.mode === 'manual' ? 'header' : undefined} aria-pressed={rules.header.mode === 'manual'} onclick={() => onpick()}>
          {rules.header.mode === 'manual' && rules.header.row !== 1 ? `Row ${rules.header.row}` : 'Manual…'}
        </button>
      </div>
    </div>
  {/if}
  <span class="vr"></span>
  <div class="grp">
    <span class="label" id="sp-save-l">Save to</span>
    <div class="row nowrap">
      <button class="dd clip" data-part="save" id="sp-folder-b" aria-labelledby="sp-save-l sp-folder-b" title={folderPath || undefined} popovertarget="sp-folder-pop" style="anchor-name: --sp-folder">{folderPath || 'Same as the source'}</button>
      <button class="dd" aria-label="Format: {FORMATS.find(([v]) => v === rules.format)?.[1]}" popovertarget="sp-format-pop" style="anchor-name: --sp-format">{FORMATS.find(([v]) => v === rules.format)?.[1]}</button>
      <button class="dd" popovertarget="sp-taken-pop" style="anchor-name: --sp-taken">If taken: {CONFLICTS.find(([v]) => v === rules.conflict)?.[2]}</button>
    </div>
    <div class="pop folder" id="sp-folder-pop" popover style="position-anchor: --sp-folder">
      <label class="label" for="sp-folder">Folder</label>
      <div class="row nowrap">
        <select id="sp-folder" class="field grow" value={folderPath ? `f:${folderPath}` : 'source'} onchange={(e) => setFolder(e.currentTarget.value)}>
          <option value="source">Same as the source</option>
          {#each favourites as f (f)}<option value="f:{f}">{f}</option>{/each}
          {#if folderPath && !starred}<option value="f:{folderPath}">{folderPath}</option>{/if}
        </select>
        <button class="ib" aria-label="Choose folder…" title="Choose folder…" onclick={() => void pickOutputFolder()}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>
        </button>
        <button class="ib" aria-pressed={starred} disabled={!folderPath} aria-label={starred ? 'Remove from favourites' : 'Add to favourites'} title={starred ? 'Remove from favourites' : 'Add to favourites'} onclick={star}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill={starred ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" /></svg>
        </button>
      </div>
    </div>
    <div class="pop" id="sp-format-pop" popover style="position-anchor: --sp-format">
      <div class="seg" role="group" aria-label="Format">
        {#each FORMATS as [v, label] (v)}
          <button aria-pressed={rules.format === v} onclick={() => (session.rules.format = v)}>{label}</button>
        {/each}
      </div>
    </div>
    <div class="pop" id="sp-taken-pop" popover style="position-anchor: --sp-taken">
      <div class="seg" role="group" aria-label="If taken">
        {#each CONFLICTS as [v, label] (v)}
          <button aria-pressed={rules.conflict === v} onclick={() => (session.rules.conflict = v)}>{label}</button>
        {/each}
      </div>
    </div>
  </div>
  <span class="grow"></span>
  <button class="btn small" disabled={session.busy || !!island.activity} onclick={reset}>Reset</button>
</div>

<style>
  .folder { width: 380px; }
  .nowrap { flex-wrap: nowrap; }
  .grow { flex: 1; min-width: 0; }
  .clip { max-width: 220px; overflow: hidden; text-overflow: ellipsis; }
</style>
