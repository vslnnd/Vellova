<script lang="ts">
  import { tick } from 'svelte';
  import { ui } from '../app.svelte';
  import { data } from '../shared/state.svelte';
  import SummaryCard from '../shared/SummaryCard.svelte';
  import type { Param, SplitMode } from '../shared/types';
  import type { Grid } from './engine/grid';
  import { headerInfo } from './engine/header';
  import { DEFAULT_TEMPLATE } from './engine/planner';
  import { splitSummary } from './engine/summary';
  import { archiveFolder, chooseArchiveFolder, edited, session } from './session.svelte';

  let { grids }: { grids: Record<string, Grid> } = $props();

  const TITLE: Record<SplitMode, string> = { value: 'Split by value', people: 'Split among people', rows: 'Rows per file', parts: 'Equal parts', sheets: 'One file per sheet' };
  const PIECES: Record<SplitMode, string> = { value: 'group', people: 'person', rows: 'part', parts: 'part', sheets: 'sheet' };

  const rules = $derived(session.rules);
  const profile = $derived(data.profiles.split.find((p) => p.id === session.profileId));
  let pasted = $state('');
  let personName = $state('');

  const grid = $derived(session.files.map((f) => grids[f.path]).find(Boolean));
  const columns = $derived(grid && rules.mode !== 'sheets' ? headerInfo(grid, rules.header).columns : []);
  const names = $derived([...new Set([...columns.map((c) => c.name), ...(rules.column.trim() ? [rules.column] : [])])]);
  const samples = $derived(columns.find((c) => c.name.trim().toLowerCase() === rules.column.trim().toLowerCase())?.samples ?? []);
  const assigned = $derived(rules.mode === 'people' && rules.peopleOutput === 'column');
  const pieces = $derived(['date', 'file', ...(assigned ? [] : [PIECES[rules.mode]])]);
  const template = $derived(assigned ? DEFAULT_TEMPLATE.assigned : DEFAULT_TEMPLATE[rules.mode]);
  const subfolders = $derived(rules.mode === 'value' || (rules.mode === 'people' && !assigned));
  const extras = $derived([subfolders && rules.subfolder && 'Subfolders', archiveFolder() && 'Archive'].filter(Boolean).join(' · ') || 'Off');

  /** Shows the settings and focuses the control for a summary line, opening its disclosure. */
  async function change(key: string) {
    session.editing = true;
    await tick();
    const el = document.querySelector<HTMLElement>(`[data-part="${key}"]`);
    const d = el?.closest('details');
    if (d) d.open = true;
    el?.focus();
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
</script>

<div class="settings">
  {#if profile && !edited.value && !session.editing}
    <SummaryCard title={profile.name} summary={splitSummary(rules, archiveFolder())} onchange={(k) => void change(k)} onedit={() => (session.editing = true)} />
  {:else}
    <div class="card mode">
      <h3 id="sp-title">{TITLE[rules.mode]}</h3>
      {#if rules.mode === 'value'}
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
      {:else if rules.mode === 'people'}
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
      {:else if rules.mode === 'rows'}
        <input class="field num" type="number" min="1" step="1" aria-labelledby="sp-title" value={rules.rows} onchange={(e) => count(e, 'rows')} />
      {:else if rules.mode === 'parts'}
        <label class="inline">Number of parts <input class="field num" type="number" min="1" step="1" value={rules.parts} onchange={(e) => count(e, 'parts')} /></label>
      {/if}

      <div class="discs">
        <details class="disclosure">
          <summary>File names<span class="val mono">{rules.template || template}</span></summary>
          <div class="body">
            <label class="label" for="sp-tpl">File name</label>
            <input id="sp-tpl" class="field mono" data-part="names" spellcheck="false" placeholder={template} bind:value={session.rules.template} />
            <div class="row chips">{#each pieces as p (p)}<span class="pill muted mono">{`{${p}}`}</span>{/each}</div>
          </div>
        </details>
        <details class="disclosure">
          <summary>Subfolders and archive<span class="val">{extras}</span></summary>
          <div class="body">
            {#if subfolders}
              <label class="inline"><input type="checkbox" data-part="subfolders" bind:checked={session.rules.subfolder} /> Subfolder per group</label>
            {/if}
            <span class="label">Archive</span>
            <div class="row nowrap">
              {#if !data.settings.split.archive}
                <span class="state">Off</span>
                <button class="btn small" data-part="archive" onclick={() => (ui.panel = 'settings')}>Settings</button>
              {:else if profile}
                <span class="state mono clip" title={profile.archiveFolder ?? undefined}>{profile.archiveFolder ?? 'None'}</span>
                <button class="btn small" data-part="archive" onclick={() => void chooseArchiveFolder(profile)}>Choose…</button>
              {:else}
                <span class="state">Needs a profile</span>
                <button class="btn small" disabled>Choose…</button>
              {/if}
            </div>
          </div>
        </details>
      </div>
    </div>
  {/if}
</div>

<style>
  .settings { flex: 0 0 300px; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 12px; padding: 0 2px 12px; }
  .mode { flex: 1 0 auto; }
  .seg { display: flex; flex-wrap: wrap; }
  .seg button { flex: 1 0 auto; white-space: nowrap; }
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
  .discs { margin-top: auto; padding-top: 8px; }
  .state { flex: 1; min-width: 0; font-size: 13px; }
</style>
