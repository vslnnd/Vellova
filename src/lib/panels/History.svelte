<script lang="ts">
  import { save as saveDialog } from '@tauri-apps/plugin-dialog';
  import { revealItemInDir } from '@tauri-apps/plugin-opener';
  import { ui } from '../app.svelte';
  import { REASONS } from '../shared/reasons';
  import { undoBatch } from '../shared/batches';
  import { ipc } from '../shared/ipc';
  import { splitPath } from '../shared/names';
  import { reportName, reportRows, toCsv } from '../shared/report';
  import { data } from '../shared/state.svelte';
  import { logToText } from '../shared/store';
  import type { Batch } from '../shared/types';
  import { island } from '../shell/islandState.svelte';
  import { rerun } from '../split/session.svelte';

  let tab = $state<'batches' | 'log'>('batches');
  let tool = $state<'all' | 'rename' | 'split' | 'app'>('all');
  let level = $state<'all' | 'warn' | 'error'>('all');
  let message = $state('');
  /** the batch or log entry whose details show */
  let open = $state<string | number | null>(null);

  const batches = $derived(data.history.filter((b) => tool === 'all' || b.tool === tool));
  // newest first; "warn" means warnings and errors
  const entries = $derived(
    data.log.filter((e) => (tool === 'all' || e.tool === tool) && (level === 'all' || e.level === 'error' || e.level === level)).slice().reverse(),
  );
  const when = (t: number) => new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const name = (p: string) => splitPath(p).name;
  const TOOL = { rename: 'Rename', split: 'Split', app: 'App' };

  function setTab(t: 'batches' | 'log') {
    tab = t;
    message = '';
    open = null;
    if (t === 'batches' && tool === 'app') tool = 'all'; // batches have no App tool
  }
  function show(b: Batch) {
    const it = b.items.find((i) => i.ok) ?? b.items[0];
    if (it) void revealItemInDir(b.undone && it.from ? it.from : it.to).catch(() => {});
  }
  async function runAgain(b: Batch) {
    ui.tool = 'split';
    ui.panel = null;
    await rerun(b);
  }
  async function exportLog() {
    message = '';
    try {
      const path = await saveDialog({ defaultPath: `vellova-log-${new Date().toISOString().slice(0, 10)}.txt`, filters: [{ name: 'Text', extensions: ['txt'] }] });
      if (!path) return;
      await ipc.saveText(path, logToText(entries.slice().reverse()));
      message = `Exported ${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}.`;
    } catch (e) {
      message = `The log couldn't be exported: ${String(e).replace(/^[a-z]+: /, '')}`;
    }
  }
  async function exportReport(b: Batch) {
    message = '';
    try {
      const picked = await saveDialog({
        defaultPath: reportName(b),
        filters: [{ name: 'Excel workbook', extensions: ['xlsx'] }, { name: 'CSV', extensions: ['csv'] }],
      });
      if (!picked) return;
      const rows = reportRows(b);
      if (/\.csv$/i.test(picked)) {
        await ipc.saveText(picked, toCsv(rows));
      } else {
        const XLSX = await import('xlsx');
        const ws = XLSX.utils.aoa_to_sheet(rows);
        ws['!cols'] = [{ wch: 17 }, { wch: 60 }, { wch: 60 }, { wch: 28 }];
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Report');
        // a name typed without an extension still gets the one the content has
        const path = /\.xlsx$/i.test(picked) ? picked : `${picked}.xlsx`;
        await ipc.saveBytes(path, new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' })));
      }
      message = 'Report saved.';
    } catch (e) {
      message = `The report couldn't be saved: ${String(e).replace(/^[a-z]+: /, '')}`;
    }
  }
</script>

{#snippet chevron()}
  <svg class="chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
{/snippet}

<div class="row">
  <div class="seg" role="group" aria-label="Show">
    <button aria-pressed={tab === 'batches'} onclick={() => setTab('batches')}>Batches</button>
    <button aria-pressed={tab === 'log'} onclick={() => setTab('log')}>Log</button>
  </div>
  <select class="field auto" aria-label="Tool" bind:value={tool}>
    <option value="all">All tools</option>
    <option value="rename">Rename</option>
    <option value="split">Split</option>
    {#if tab === 'log'}<option value="app">App</option>{/if}
  </select>
  {#if tab === 'log'}
    <select class="field auto" aria-label="Severity" bind:value={level}>
      <option value="all">Everything</option>
      <option value="warn">Warnings and errors</option>
      <option value="error">Errors</option>
    </select>
  {/if}
  {#if message}<span class="status" role="status">{message}</span>{/if}
  <span class="grow"></span>
  {#if tab === 'log'}<button class="btn small" disabled={!entries.length} onclick={() => void exportLog()}>Export .txt</button>{/if}
</div>

{#if tab === 'batches'}
  {#if batches.length}
    <div class="rows">
      {#each batches as b (b.id)}
        <div class="item" class:open={open === b.id}>
          <div class="top">
            <button class="toggle" aria-expanded={open === b.id} onclick={() => (open = open === b.id ? null : b.id)}>
              {@render chevron()}
              <span class="what">{b.summary}</span>
              {#if b.undone}<span class="pill muted">Undone</span>{/if}
              <span class="meta">{TOOL[b.tool]} · {when(b.time)}{b.profile ? ` · ${b.profile}` : ''}</span>
            </button>
            {#if b.undoable && !b.undone}<button class="btn small" disabled={!!island.activity} onclick={() => void undoBatch(b.id)}>Undo</button>{/if}
            {#if b.rerun}<button class="btn small" disabled={!!island.activity} onclick={() => void runAgain(b)}>Run again</button>{/if}
            <button class="ib" title="Show files" aria-label="Show files" onclick={() => show(b)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>
            </button>
            <button class="ib" title="Export report" aria-label="Export report" onclick={() => void exportReport(b)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></svg>
            </button>
          </div>
          {#if open === b.id}
            <ul>
              {#each b.items as it, i (i)}
                <li>
                  <span class="mono from">{it.from ? name(it.from) : '-'}</span>
                  <span class="mono">{name(it.to)}</span>
                  {#if it.pending}
                    <span class="pill warn">Unfinished</span>
                  {:else if !it.ok}
                    <span class="pill err">{it.reason ? REASONS[it.reason].title : 'Failed'}</span>
                  {:else if it.reason}
                    <span class="pill warn" title="Done, but Undo can't reverse this file.">Done · can't be undone</span>
                  {:else}
                    <span></span>
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      {/each}
    </div>
  {:else}
    <p class="none" role="status">No batches yet.</p>
  {/if}
{:else if entries.length}
  <div class="rows">
    {#each entries as e, i (i)}
      <div class="item" class:open={open === i}>
        <div class="top">
          <button class="toggle" aria-expanded={open === i} onclick={() => (open = open === i ? null : i)}>
            {@render chevron()}
            <span class="pill {e.level === 'error' ? 'err' : e.level === 'warn' ? 'warn' : 'muted'}">{e.level}</span>
            <span class="what">{e.message}</span>
            <span class="meta">{TOOL[e.tool]} · {when(e.t)}{e.file ? ` · ${name(e.file)}` : ''}</span>
          </button>
        </div>
        {#if open === i && (e.file || e.detail)}
          <div class="detail">
            {#if e.file}<p class="mono small">{e.file}</p>{/if}
            {#if e.detail}<pre class="mono small">{e.detail}</pre>{/if}
          </div>
        {/if}
      </div>
    {/each}
  </div>
{:else}
  <p class="none" role="status">Nothing logged.</p>
{/if}

<style>
  .auto { width: auto; }
  .grow { flex: 1; }
  .status { font-size: 12.5px; color: var(--text2); }
  .none { margin: 24px 0; text-align: center; color: var(--text3); }
  .top { display: flex; align-items: center; gap: 6px; padding: 6px 10px 6px 6px; }
  .toggle { flex: 1; min-width: 0; display: flex; align-items: center; flex-wrap: wrap; gap: 4px 10px; min-height: 40px; padding: 4px 8px; border: 0; border-radius: 6px; background: none; text-align: left; }
  .toggle:hover { background: var(--hover); }
  .chev { color: var(--text3); transition: rotate 160ms ease; }
  .open .chev { rotate: 90deg; }
  .what { font-weight: 500; }
  .meta { font-size: 12.5px; color: var(--text3); }
  ul { margin: 0; padding: 2px 16px 12px 38px; list-style: none; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto; gap: 4px 16px; font-size: 12.5px; }
  li { display: contents; }
  li span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .from { color: var(--text2); }
  .detail { padding: 0 16px 12px 38px; }
  .small { font-size: 12px; margin: 4px 0 0; white-space: pre-wrap; word-break: break-all; color: var(--text2); }
</style>
