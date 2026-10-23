<script lang="ts">
  import { open } from '@tauri-apps/plugin-dialog';
  import { ipc } from '../shared/ipc';
  import { extOf, splitPath } from '../shared/names';
  import type { Position, Step } from '../shared/types';
  import { readGrid } from '../split/sheets';
  import { listKey, patternError } from './engine/steps';
  import { listReadError, refresh, session } from './session.svelte';

  /** `first`: step 1, which carries the tour's keyword and position targets */
  let { step: s, first }: { step: Step; first: boolean } = $props();
  const uid = $props.id();

  const POSITIONS: [Position, string][] = [['after', 'After'], ['before', 'Before'], ['below', 'Below'], ['above', 'Above']];
  const PRESETS = [['invoice', 'Invoice-style number'], ['date', 'Date'], ['custom', 'Custom pattern'], ['title', 'Document title'], ['created', 'Creation date']] as const;
  const CASES = [['upper', 'UPPER'], ['lower', 'lower'], ['title', 'Title'], ['sentence', 'Sentence']] as const;
  const AT = [['start', 'Start'], ['end', 'End']] as const;

  // a list's header names, read once per path
  let headers = $state<string[]>([]);
  let headerError = $state<string | null>(null);
  const listPath = $derived(s.type === 'list' ? s.path : '');
  async function readHeaders(path: string) {
    headers = [];
    headerError = null;
    if (!path) return;
    try {
      const f = (await ipc.listFiles([path], false))[0];
      if (!f) throw 'missing:';
      // the session's key, so the sheet worker parses each version once
      const grid = await readGrid(`list|${f.path}|${f.size}|${f.mtime}`, extOf(f.path), await ipc.readFile(f.path), null);
      if (path === listPath) headers = (grid.rows[0] ?? []).map((h) => h.trim()).filter(Boolean);
    } catch (e) {
      if (path === listPath) headerError = (e as Error)?.message ?? listReadError(e);
    }
  }
  $effect(() => void readHeaders(listPath));
  /** a select's choices: the header names, plus the saved one when the list lacks it */
  const columns = (saved: string) => [...new Set([...headers, saved].filter(Boolean))];
  const listError = $derived(
    s.type !== 'list' || !s.path ? null : (headerError ?? (s.match && s.name ? session.listErrors[listKey(s)] : null) ?? null),
  );

  async function chooseList() {
    if (s.type !== 'list') return;
    const picked = await open({ filters: [{ name: 'Lists', extensions: ['xlsx', 'xls', 'csv'] }] });
    if (typeof picked === 'string') Object.assign(s, { path: picked, match: '', name: '' });
  }
  function readAgain() {
    void readHeaders(listPath);
    void refresh();
  }

  function setInsert(text: string) {
    if (s.type !== 'addText') return;
    if (text) s.insert = { text, at: s.insert?.at ?? 0 };
    else delete s.insert;
  }
</script>

{#if s.type === 'pdfValue'}
  <label class="label" for="{uid}-kw">Keyword</label>
  <input id="{uid}-kw" data-tour={first ? 'keyword' : undefined} class="field mono" placeholder="Invoice No.:" spellcheck="false" bind:value={s.keyword} />
  <span class="label" id="{uid}-pos">The value is … the keyword</span>
  <div class="seg" role="group" aria-labelledby="{uid}-pos" data-tour={first ? 'position' : undefined}>
    {#each POSITIONS as [v, label] (v)}
      <button aria-pressed={s.position === v} onclick={() => s.type === 'pdfValue' && (s.position = v)}>{label}</button>
    {/each}
  </div>
  <label class="inline">Use match number <input class="field num" type="number" min="1" max="99" bind:value={s.occurrence} /></label>
{:else if s.type === 'pdfPattern'}
  <label class="label" for="{uid}-pre">Find</label>
  <select id="{uid}-pre" class="field" bind:value={s.preset}>
    {#each PRESETS as [v, label] (v)}<option value={v}>{label}</option>{/each}
  </select>
  {#if s.preset === 'custom'}
    <label class="label" for="{uid}-re">Pattern</label>
    <input id="{uid}-re" class="field mono" spellcheck="false" bind:value={s.regex} />
    {#if patternError(s)}<p class="err" role="alert">{patternError(s)}</p>{/if}
  {/if}
  {#if s.preset !== 'title' && s.preset !== 'created'}
    <label class="inline">Use match number <input class="field num" type="number" min="1" max="99" bind:value={s.occurrence} /></label>
  {/if}
{:else if s.type === 'list'}
  <div class="row">
    <button class="btn small" data-part="choose-list" onclick={() => void chooseList()}>Choose list…</button>
    {#if s.path}<span class="file mono" title={s.path}>{splitPath(s.path).name}</span>{/if}
  </div>
  {#if listError}
    <div class="row"><p class="err" role="alert">{listError}</p><button class="btn small" onclick={readAgain}>Read again</button></div>
  {/if}
  {#if s.path}
    <div class="two">
      <label class="label">Match column
        <select class="field" bind:value={s.match}>
          <option value="" disabled>Column</option>
          {#each columns(s.match) as h (h)}<option value={h}>{h}</option>{/each}
        </select>
      </label>
      <label class="label">New name column
        <select class="field" bind:value={s.name}>
          <option value="" disabled>Column</option>
          {#each columns(s.name) as h (h)}<option value={h}>{h}</option>{/each}
        </select>
      </label>
    </div>
    <span class="label" id="{uid}-ag">Match against</span>
    <div class="seg" role="group" aria-labelledby="{uid}-ag">
      <button aria-pressed={s.against === 'name'} onclick={() => s.type === 'list' && (s.against = 'name')}>File name</button>
      <button aria-pressed={s.against === 'value'} onclick={() => s.type === 'list' && (s.against = 'value')}>Value found before</button>
    </div>
  {/if}
{:else if s.type === 'addText'}
  <div class="two">
    <label class="label">At the start <input class="field mono" spellcheck="false" bind:value={s.prefix} /></label>
    <label class="label">At the end <input class="field mono" spellcheck="false" bind:value={s.suffix} /></label>
    <label class="label">Insert <input class="field mono" spellcheck="false" value={s.insert?.text ?? ''} oninput={(e) => setInsert(e.currentTarget.value)} /></label>
    {#if s.insert}
      <label class="label">At position <input class="field" type="number" min="0" bind:value={s.insert.at} /></label>
    {/if}
  </div>
{:else if s.type === 'replace'}
  <div class="two">
    <label class="label">Find <input class="field mono" spellcheck="false" bind:value={s.find} /></label>
    <label class="label">Replace with <input class="field mono" spellcheck="false" bind:value={s.with} /></label>
  </div>
  <label class="inline"><input type="checkbox" bind:checked={s.all} /> Every match</label>
  <label class="inline"><input type="checkbox" bind:checked={s.matchCase} /> Match case</label>
  <label class="inline"><input type="checkbox" bind:checked={s.regex} /> Regular expression</label>
{:else if s.type === 'remove'}
  <select class="field" aria-label="Remove" bind:value={s.what}>
    <option value="range">Characters</option>
    <option value="digits">Digits</option>
    <option value="between">Text between</option>
  </select>
  {#if s.what === 'range'}
    <div class="two">
      <label class="label">From <input class="field" type="number" min="1" bind:value={s.from} /></label>
      <label class="label">To <input class="field" type="number" min="1" bind:value={s.to} /></label>
    </div>
  {:else if s.what === 'between'}
    <div class="two">
      <label class="label">Start <input class="field mono" spellcheck="false" bind:value={s.start} /></label>
      <label class="label">End <input class="field mono" spellcheck="false" bind:value={s.end} /></label>
    </div>
  {/if}
{:else if s.type === 'case'}
  <div class="seg" role="group" aria-label="Case">
    {#each CASES as [v, label] (v)}
      <button aria-pressed={s.to === v} onclick={() => s.type === 'case' && (s.to = v)}>{label}</button>
    {/each}
  </div>
{:else if s.type === 'number'}
  <div class="two">
    <label class="label">Start <input class="field" type="number" min="0" bind:value={s.start} /></label>
    <label class="label">Step <input class="field" type="number" min="1" bind:value={s.step} /></label>
    <label class="label">Digits <input class="field" type="number" min="1" max="12" bind:value={s.pad} /></label>
    <label class="label">Separator <input class="field mono" spellcheck="false" bind:value={s.sep} /></label>
  </div>
  {@render at(s)}
{:else if s.type === 'date'}
  <div class="two">
    <label class="label">Date
      <select class="field" bind:value={s.from}>
        <option value="today">Today</option>
        <option value="modified">Date modified</option>
        <option value="created">Date created</option>
      </select>
    </label>
    <label class="label">Format <input class="field mono" spellcheck="false" bind:value={s.format} /></label>
    <label class="label">Separator <input class="field mono" spellcheck="false" bind:value={s.sep} /></label>
  </div>
  {@render at(s)}
{/if}

{#snippet at(t: Extract<Step, { type: 'number' | 'date' }>)}
  <div class="seg" role="group" aria-label="Where">
    {#each AT as [v, label] (v)}
      <button aria-pressed={t.at === v} onclick={() => (t.at = v)}>{label}</button>
    {/each}
  </div>
{/snippet}

<style>
  .two { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .two .label { display: flex; flex-direction: column; gap: 4px; }
  .num { width: 64px; }
  .file { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: var(--text2); }
  .err { margin: 0; flex: 1; min-width: 0; font-size: 12px; color: var(--errink); }
  .seg { align-self: flex-start; flex-wrap: wrap; }
</style>
