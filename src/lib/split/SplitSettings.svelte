<script lang="ts">
  import { data, save } from '../shared/state.svelte';
  import type { Conflict, Param, SplitMode, SplitRules } from '../shared/types';
  import type { Grid } from './engine/grid';
  import { headerInfo } from './engine/header';
  import { DEFAULT_TEMPLATE } from './engine/planner';
  import { pickOutputFolder, saveProfile, session, useProfile } from './session.svelte';

  let { grids, onpick }: { grids: Record<string, Grid>; onpick: () => void } = $props();

  const MODES: [SplitMode, string][] = [['value', 'By value'], ['people', 'People'], ['rows', 'Rows'], ['parts', 'Parts'], ['sheets', 'Sheets']];
  const FORMATS: [SplitRules['format'], string][] = [['same', 'Same as input'], ['xlsx', 'Always .xlsx'], ['csv', 'Always .csv']];
  const CONFLICTS: [Conflict, string][] = [['add', 'Add (1)'], ['skip', 'Skip'], ['replace', 'Replace (Recycle Bin)']];
  const PIECES: Record<SplitMode, string> = { value: 'group', people: 'person', rows: 'part', parts: 'part', sheets: 'sheet' };

  const rules = $derived(session.rules);
  const current = $derived(data.profiles.split.find((p) => p.id === session.profileId));
  let naming = $state(false);
  let newName = $state('');
  let pasted = $state('');
  let personName = $state('');

  const first = $derived(grids[session.files[0]?.path ?? '']);
  const grid = $derived(session.files.map((f) => grids[f.path]).find(Boolean));
  const columns = $derived(grid && rules.mode !== 'sheets' ? headerInfo(grid, rules.header).columns : []);
  const names = $derived([...new Set([...columns.map((c) => c.name), ...(rules.column.trim() ? [rules.column] : [])])]);
  const samples = $derived(columns.find((c) => c.name.trim().toLowerCase() === rules.column.trim().toLowerCase())?.samples ?? []);
  const assigned = $derived(rules.mode === 'people' && rules.peopleOutput === 'column');
  const pieces = $derived(['date', 'file', ...(assigned ? [] : [PIECES[rules.mode]])]);
  const favourites = $derived(data.settings.split.favourites);
  const folderPath = $derived(rules.folder.mode === 'folder' ? rules.folder.path : '');
  const starred = $derived(!!folderPath && favourites.includes(folderPath));

  function pick(id: string) {
    const p = data.profiles.split.find((x) => x.id === id);
    if (p) useProfile(p);
    else session.profileId = null;
  }
  function saveNew() {
    if (!newName.trim()) return;
    saveProfile(newName.trim());
    naming = false;
    newName = '';
  }

  /** Whole numbers from `min` up; anything else puts the field back. */
  function count(e: Event & { currentTarget: HTMLInputElement }, key: 'rows' | 'parts') {
    const v = Math.floor(Number(e.currentTarget.value));
    if (v >= 1) session.rules[key] = v;
    else e.currentTarget.value = String(session.rules[key]);
  }
  function weight(e: Event & { currentTarget: HTMLInputElement }, i: number) {
    const v = Number(e.currentTarget.value);
    if (e.currentTarget.value !== '' && v >= 0) session.rules.people[i].weight = v;
    else e.currentTarget.value = String(session.rules.people[i].weight);
  }

  /** Tab-separated lines from Excel: value, label, payable (no, false, 0 or n mean not payable). A `Value` header line is left out. */
  function addLines(text: string) {
    const add: Param[] = text.split(/\r?\n/).flatMap((line, i) => {
      const [value = '', label = '', payable] = line.split('\t').map((c) => c.trim());
      if (!value || (i === 0 && value.toLowerCase() === 'value')) return [];
      return [{ value, label, payable: payable === undefined || payable === '' || !/^(no|false|0|n)$/i.test(payable) }];
    });
    session.rules.params = [...session.rules.params, ...add];
    pasted = '';
  }
  function onpaste(e: ClipboardEvent) {
    e.preventDefault();
    addLines(e.clipboardData?.getData('text') ?? '');
  }
  function addPerson() {
    if (!personName.trim()) return;
    session.rules.people = [...session.rules.people, { name: personName.trim(), weight: 1 }];
    personName = '';
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

<div class="settings">
  <div class="card">
    <label class="label" for="sp-profile">Profile</label>
    <select id="sp-profile" class="field" value={session.profileId ?? ''} onchange={(e) => pick(e.currentTarget.value)}>
      <option value="">No profile</option>
      {#each data.profiles.split as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
    </select>
    <div class="row">
      {#if current}<button class="btn small" onclick={() => saveProfile()}>Save</button>{/if}
      {#if naming}
        <input class="field grow" aria-label="New profile name" placeholder="Profile name" bind:value={newName} onkeydown={(e) => e.key === 'Enter' && saveNew()} />
        <button class="btn small primary" disabled={!newName.trim()} onclick={saveNew}>Save</button>
      {:else}
        <button class="btn small" onclick={() => (naming = true)}>Save as new profile</button>
      {/if}
    </div>
  </div>

  <div class="card">
    <span class="label" id="sp-mode">Mode</span>
    <div class="seg modes" role="group" aria-labelledby="sp-mode">
      {#each MODES as [v, label] (v)}
        <button aria-pressed={rules.mode === v} onclick={() => (session.rules.mode = v)}>{label}</button>
      {/each}
    </div>
    {#if first && first.sheets.length > 1 && rules.mode !== 'sheets'}
      <label class="label" for="sp-sheet">Sheet</label>
      <select id="sp-sheet" class="field" value={rules.sheet ?? first.sheets[0].name} onchange={(e) => (session.rules.sheet = e.currentTarget.value === first.sheets[0].name ? null : e.currentTarget.value)}>
        {#each first.sheets as s (s.name)}<option value={s.name}>{s.name}</option>{/each}
      </select>
    {/if}
    {#if rules.mode !== 'sheets'}
      <span class="label" id="sp-head">Header row</span>
      <div class="seg" role="group" aria-labelledby="sp-head">
        <button aria-pressed={rules.header.mode === 'default'} onclick={() => (session.rules.header = { mode: 'default' })}>Default (1st row)</button>
        <button aria-pressed={rules.header.mode === 'manual'} onclick={() => onpick()}>Manual</button>
      </div>
      {#if rules.header.mode === 'manual'}
        <div class="row">
          <span class="hint">Row {rules.header.row}</span>
          <button class="btn small" onclick={() => onpick()}>Choose header row</button>
        </div>
      {/if}
    {/if}
  </div>

  {#if rules.mode === 'value'}
    <div class="card">
      <h3>By value</h3>
      <label class="label" for="sp-col">Column</label>
      <select id="sp-col" class="field" value={rules.column} onchange={(e) => (session.rules.column = e.currentTarget.value)}>
        <option value="">Choose a column</option>
        {#each names as n (n)}<option value={n}>{n}</option>{/each}
      </select>
      {#if samples.length}<p class="hint mono clip" title={samples.join(', ')}>{samples.join(', ')}</p>{/if}
      {#if rules.params.length}
      <table class="params">
        <thead><tr><th>Value</th><th>Label</th><th>Payable</th><th><span class="sr">Remove</span></th></tr></thead>
        <tbody>
          {#each rules.params as p, i (i)}
            <tr>
              <td><input class="field mono" aria-label="Value {i + 1}" spellcheck="false" bind:value={p.value} /></td>
              <td><input class="field" aria-label="Label {i + 1}" spellcheck="false" bind:value={p.label} /></td>
              <td class="c"><input type="checkbox" aria-label="Payable {i + 1}" bind:checked={p.payable} /></td>
              <td>
                <button class="ib" aria-label="Remove value {i + 1}" title="Remove" onclick={() => (session.rules.params = rules.params.filter((_, k) => k !== i))}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
                </button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
      {/if}
      <div class="row">
        <button class="btn small" onclick={() => (session.rules.params = [...rules.params, { value: '', label: '', payable: true }])}>Add row</button>
      </div>
      <textarea class="field paste mono" aria-label="Paste values" placeholder="Paste rows from Excel: value, label, payable" spellcheck="false" bind:value={pasted} {onpaste}></textarea>
      {#if pasted.trim()}<div class="row"><button class="btn small" onclick={() => addLines(pasted)}>Add lines</button></div>{/if}
      <label class="inline"><input type="checkbox" bind:checked={session.rules.nonMatching} /> Keep non-matching rows</label>
    </div>
  {:else if rules.mode === 'people'}
    <div class="card">
      <h3>People</h3>
      {#each rules.people as p, i (i)}
        <div class="person">
          <input class="field" aria-label="Name {i + 1}" spellcheck="false" bind:value={p.name} />
          <input class="field num" type="number" min="0" step="any" aria-label="Weight of {p.name || `person ${i + 1}`}" title="Weight" value={p.weight} onchange={(e) => weight(e, i)} />
          <button class="ib" aria-label="Remove {p.name || `person ${i + 1}`}" title="Remove" onclick={() => (session.rules.people = rules.people.filter((_, k) => k !== i))}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
      {/each}
      <div class="row">
        <input class="field grow" aria-label="New person" placeholder="Name" spellcheck="false" bind:value={personName} onkeydown={(e) => e.key === 'Enter' && addPerson()} />
        <button class="btn small" disabled={!personName.trim()} onclick={addPerson}>Add</button>
      </div>
      {#if rules.people.length}<p class="hint">The number next to a name is its weight: 2 gets twice the rows of 1.</p>{/if}
      <div class="seg" role="group" aria-label="How rows are shared">
        <button aria-pressed={rules.assign === 'blocks'} onclick={() => (session.rules.assign = 'blocks')}>Even blocks</button>
        <button aria-pressed={rules.assign === 'groups'} onclick={() => (session.rules.assign = 'groups')}>Keep groups together</button>
      </div>
      {#if rules.assign === 'groups'}
        <label class="label" for="sp-group">Group column</label>
        <select id="sp-group" class="field" value={rules.column} onchange={(e) => (session.rules.column = e.currentTarget.value)}>
          <option value="">Choose a column</option>
          {#each names as n (n)}<option value={n}>{n}</option>{/each}
        </select>
        {#if samples.length}<p class="hint mono clip" title={samples.join(', ')}>{samples.join(', ')}</p>{/if}
      {/if}
      <div class="seg" role="group" aria-label="What is written">
        <button aria-pressed={rules.peopleOutput === 'files'} onclick={() => (session.rules.peopleOutput = 'files')}>One file per person</button>
        <button aria-pressed={rules.peopleOutput === 'column'} onclick={() => (session.rules.peopleOutput = 'column')}>Assigned to column</button>
      </div>
      <label class="inline"><input type="checkbox" bind:checked={session.rules.summary} /> Summary</label>
    </div>
  {:else if rules.mode === 'rows'}
    <div class="card">
      <label class="inline">Rows per file <input class="field num" type="number" min="1" step="1" value={rules.rows} onchange={(e) => count(e, 'rows')} /></label>
    </div>
  {:else if rules.mode === 'parts'}
    <div class="card">
      <label class="inline">Number of parts <input class="field num" type="number" min="1" step="1" value={rules.parts} onchange={(e) => count(e, 'parts')} /></label>
    </div>
  {/if}

  <div class="card">
    <h3>Output</h3>
    <label class="label" for="sp-tpl">File name</label>
    <input id="sp-tpl" class="field mono" spellcheck="false" placeholder={assigned ? DEFAULT_TEMPLATE.assigned : DEFAULT_TEMPLATE[rules.mode]} bind:value={session.rules.template} />
    <div class="row chips">{#each pieces as p (p)}<span class="pill muted mono">{`{${p}}`}</span>{/each}</div>
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
    {#if rules.mode === 'value' || (rules.mode === 'people' && !assigned)}
      <label class="inline"><input type="checkbox" bind:checked={session.rules.subfolder} /> Subfolder per group</label>
    {/if}
    <span class="label" id="sp-format">Format</span>
    <div class="seg" role="group" aria-labelledby="sp-format">
      {#each FORMATS as [v, label] (v)}
        <button aria-pressed={rules.format === v} onclick={() => (session.rules.format = v)}>{label}</button>
      {/each}
    </div>
    <span class="label" id="sp-conf">Existing files</span>
    <div class="seg" role="group" aria-labelledby="sp-conf">
      {#each CONFLICTS as [v, label] (v)}
        <button aria-pressed={rules.conflict === v} onclick={() => (session.rules.conflict = v)}>{label}</button>
      {/each}
    </div>
  </div>
</div>

<style>
  .settings { flex: 0 0 300px; overflow: auto; display: flex; flex-direction: column; gap: 12px; padding: 0 2px 12px; }
  .seg { display: flex; flex-wrap: wrap; }
  .seg button { flex: 1 0 auto; white-space: nowrap; }
  /* five modes on one line in the 300 px column */
  .modes { flex-wrap: nowrap; gap: 1px; }
  .modes button { flex: 1 1 auto; padding: 0 5px; font-size: 12.5px; }
  .grow { flex: 1; min-width: 0; }
  .nowrap { flex-wrap: nowrap; }
  .num { width: 72px; }
  .clip { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .chips { gap: 4px; }
  .params { width: 100%; border-collapse: collapse; table-layout: fixed; }
  .params th { font-size: 12px; font-weight: 500; color: var(--text2); text-align: left; padding: 0 2px 2px; }
  .params th:nth-child(3) { width: 54px; }
  .params th:nth-child(4) { width: 34px; }
  .params td { padding: 2px; }
  .params .field { height: 28px; padding: 0 6px; }
  .c { text-align: center; }
  .paste { height: 52px; padding: 6px 10px; resize: vertical; font-size: 12px; }
  .person { display: flex; gap: 6px; align-items: center; }
  .person .field { height: 28px; }
</style>
