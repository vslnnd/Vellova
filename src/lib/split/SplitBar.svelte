<script lang="ts">
  import { ui } from '../app.svelte';
  import { data, save } from '../shared/state.svelte';
  import ProfileBar from '../shared/ProfileBar.svelte';
  import type { Conflict, SplitMode, SplitRules } from '../shared/types';
  import { island } from '../shell/islandState.svelte';
  import type { Grid } from './engine/grid';
  import { DEFAULT_TEMPLATE } from './engine/planner';
  import { archiveFolder, chooseArchiveFolder, pickOutputFolder, pickProfile, reset, saveProfile, session } from './session.svelte';

  let { grids, onpick }: { grids: Record<string, Grid>; onpick: () => void } = $props();

  const MODES: [SplitMode, string][] = [['value', 'Value'], ['people', 'People'], ['rows', 'Rows'], ['parts', 'Parts'], ['sheets', 'Sheets']];
  const FORMATS: [SplitRules['format'], string][] = [['same', 'Same type'], ['xlsx', '.xlsx'], ['csv', '.csv']];
  const CONFLICTS: [Conflict, string, string?][] = [['add', 'Add (1)'], ['skip', 'Skip'], ['replace', 'Replace', 'The file that is there goes to the Recycle Bin']];
  const PIECES: Record<SplitMode, string> = { value: 'group', people: 'person', rows: 'part', parts: 'part', sheets: 'sheet' };

  const rules = $derived(session.rules);
  const profile = $derived(data.profiles.split.find((p) => p.id === session.profileId));
  const first = $derived(grids[session.files[0]?.path ?? '']);
  const favourites = $derived(data.settings.split.favourites);
  const folderPath = $derived(rules.folder.mode === 'folder' ? rules.folder.path : '');
  const starred = $derived(!!folderPath && favourites.includes(folderPath));
  const assigned = $derived(rules.mode === 'people' && rules.peopleOutput === 'column');
  const pieces = $derived(['date', 'file', ...(assigned ? [] : [PIECES[rules.mode]])]);
  const template = $derived(assigned ? DEFAULT_TEMPLATE.assigned : DEFAULT_TEMPLATE[rules.mode]);
  const subfolders = $derived(rules.mode === 'value' || (rules.mode === 'people' && !assigned));
  /** something under Options is not the default */
  const custom = $derived(
    rules.sheet !== null || rules.header.mode === 'manual' || rules.folder.mode === 'folder' || rules.format !== 'same' ||
      rules.conflict !== 'add' || !!rules.template.trim() || (subfolders && rules.subfolder) || !!archiveFolder() || !!rules.zip,
  );

  function setZip(on: boolean) {
    if (on) session.rules.zip = true;
    else delete session.rules.zip;
  }
  let opts = $state<HTMLElement>();

  function setFolder(v: string) {
    if (v === 'source') session.rules.folder = { mode: 'source' };
    else if (v.startsWith('f:')) session.rules.folder = { mode: 'folder', path: v.slice(2) };
  }
  function star() {
    if (!folderPath) return;
    data.settings.split.favourites = starred ? favourites.filter((f) => f !== folderPath) : [...favourites, folderPath];
    save('settings');
  }
  /** The header grid is a dialog of its own: Options closes first. */
  function manual() {
    opts?.hidePopover();
    onpick();
  }
  function settings() {
    opts?.hidePopover();
    ui.panel = 'settings';
  }
</script>

<div class="card bar">
  <ProfileBar id="sp-profile" profiles={data.profiles.split} current={session.profileId} onpick={pickProfile} onsave={saveProfile} />
  <span class="vr"></span>
  <div class="grp">
    <span class="label" id="sp-mode">Split by</span>
    <div class="seg" role="group" aria-labelledby="sp-mode">
      {#each MODES as [v, label] (v)}
        <button data-part={rules.mode === v ? 'mode' : undefined} aria-pressed={rules.mode === v} onclick={() => (session.rules.mode = v)}>{label}</button>
      {/each}
    </div>
  </div>
  <span class="grow"></span>
  <button class="btn" data-part="options" popovertarget="sp-opts" style="anchor-name: --sp-opts">
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M7 12h10M10 17h4" /></svg>
    Options
    {#if custom}<span class="dot"></span><span class="sr">changed</span>{/if}
  </button>
  <div class="pop opts" id="sp-opts" popover bind:this={opts} style="position-anchor: --sp-opts">
    {#if first && first.sheets.length > 1 && rules.mode !== 'sheets'}
      <div class="line">
        <label class="label" for="sp-sheet">Sheet</label>
        <select id="sp-sheet" class="field auto" value={rules.sheet ?? first.sheets[0].name} onchange={(e) => (session.rules.sheet = e.currentTarget.value === first.sheets[0].name ? null : e.currentTarget.value)}>
          {#each first.sheets as s (s.name)}<option value={s.name}>{s.name}</option>{/each}
        </select>
      </div>
    {/if}
    {#if rules.mode !== 'sheets'}
      <div class="line">
        <span class="label" id="sp-head">Header</span>
        <div class="seg" role="group" aria-labelledby="sp-head">
          <button data-part={rules.header.mode === 'default' ? 'header' : undefined} aria-pressed={rules.header.mode === 'default'} onclick={() => (session.rules.header = { mode: 'default' })}>Row 1</button>
          <button data-part={rules.header.mode === 'manual' ? 'header' : undefined} aria-pressed={rules.header.mode === 'manual'} onclick={manual}>
            {rules.header.mode === 'manual' && rules.header.row !== 1 ? `Row ${rules.header.row}` : 'Choose…'}
          </button>
        </div>
      </div>
    {/if}
    <div class="line">
      <label class="label" for="sp-folder">Save to</label>
      <div class="row nowrap wide">
        <select id="sp-folder" class="field grow" data-part="save" title={folderPath || undefined} value={folderPath ? `f:${folderPath}` : 'source'} onchange={(e) => setFolder(e.currentTarget.value)}>
          <option value="source">Same folder as the source</option>
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
    <div class="line">
      <span class="label" id="sp-format-l">Format</span>
      <div class="seg" role="group" aria-labelledby="sp-format-l">
        {#each FORMATS as [v, label] (v)}
          <button aria-pressed={rules.format === v} onclick={() => (session.rules.format = v)}>{label}</button>
        {/each}
      </div>
    </div>
    <div class="line">
      <span class="label" id="sp-taken-l">If taken</span>
      <div class="seg" role="group" aria-labelledby="sp-taken-l">
        {#each CONFLICTS as [v, label, tip] (v)}
          <button aria-pressed={rules.conflict === v} title={tip} onclick={() => (session.rules.conflict = v)}>{label}</button>
        {/each}
      </div>
    </div>
    <div class="line">
      <label class="label" for="sp-tpl">File names</label>
      <input id="sp-tpl" class="field mono tpl" data-part="names" spellcheck="false" placeholder={template} bind:value={session.rules.template} />
      <div class="row wide">
        {#each pieces as p (p)}<button class="chip mono" onclick={() => (session.rules.template = (rules.template || '') + `{${p}}`)}>{`{${p}}`}</button>{/each}
      </div>
    </div>
    {#if subfolders}
      <div class="line">
        <label class="label" for="sp-sub">Subfolder per group</label>
        <input id="sp-sub" type="checkbox" data-part="subfolders" bind:checked={session.rules.subfolder} />
      </div>
    {/if}
    <div class="line">
      <span class="label">Archive originals</span>
      <div class="row nowrap">
        {#if !data.settings.split.archive}
          <span class="state">Off</span>
          <button class="btn small" data-part="archive" onclick={settings}>Settings</button>
        {:else if profile}
          <span class="state mono clip" title={profile.archiveFolder ?? undefined}>{profile.archiveFolder ?? 'None'}</span>
          <button class="btn small" data-part="archive" onclick={() => void chooseArchiveFolder(profile)}>Choose…</button>
        {:else}
          <span class="state">Needs a profile</span>
          <button class="btn small" data-part="archive" disabled>Choose…</button>
        {/if}
      </div>
    </div>
    <label class="line">
      <span class="label">Also make a .zip</span>
      <input class="switch" type="checkbox" data-part="zip" checked={!!rules.zip} onchange={(e) => setZip(e.currentTarget.checked)} />
    </label>
    <div class="line">
      <span></span>
      <button class="btn small" disabled={session.busy || !!island.activity} onclick={reset}>Reset</button>
    </div>
  </div>
</div>

<style>
  .nowrap { flex-wrap: nowrap; }
  .grow { flex: 1; min-width: 0; }
  .auto { width: auto; }
  .tpl { width: 250px; }
  .state { font-size: 13px; }
  .clip { max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
