<script lang="ts">
  import { save as saveDialog } from '@tauri-apps/plugin-dialog';
  import { revealItemInDir } from '@tauri-apps/plugin-opener';
  import { REASONS } from '../rename/session.svelte';
  import { undoBatch } from '../shared/batches';
  import { ipc } from '../shared/ipc';
  import { splitPath } from '../shared/names';
  import { data } from '../shared/state.svelte';
  import { logToText } from '../shared/store';
  import type { Batch } from '../shared/types';
  import { island } from '../shell/islandState.svelte';

  let tab = $state<'batches' | 'log'>('batches');
  let tool = $state<'all' | 'rename' | 'split' | 'app'>('all');
  let level = $state<'all' | 'warn' | 'error'>('all');
  let message = $state('');

  const batches = $derived(data.history.filter((b) => tool === 'all' || b.tool === tool));
  // newest first; "warn" means warnings and errors
  const entries = $derived(
    data.log.filter((e) => (tool === 'all' || e.tool === tool) && (level === 'all' || e.level === 'error' || e.level === level)).slice().reverse(),
  );
  const when = (t: number) => new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const name = (p: string) => splitPath(p).name;

  function setTab(t: 'batches' | 'log') {
    tab = t;
    message = '';
    if (t === 'batches' && tool === 'app') tool = 'all'; // batches have no App tool
  }
  function show(b: Batch) {
    const it = b.items.find((i) => i.ok) ?? b.items[0];
    if (it) void revealItemInDir(b.undone && it.from ? it.from : it.to).catch(() => {});
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
</script>

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
    <button class="btn small" disabled={!entries.length} onclick={() => void exportLog()}>Export .txt</button>
  {/if}
</div>
{#if message}<p class="hint" role="status">{message}</p>{/if}

{#if tab === 'batches'}
  {#each batches as b (b.id)}
    <details class="item">
      <summary>
        <span class="what">{b.summary}</span>
        {#if b.undone}<span class="pill muted">Undone</span>{/if}
        <span class="meta">{when(b.time)}{b.profile ? ` · ${b.profile}` : ''}</span>
      </summary>
      <div class="row">
        {#if b.undoable && !b.undone}<button class="btn small" disabled={!!island.activity} onclick={() => void undoBatch(b.id)}>Undo</button>{/if}
        <button class="btn small" onclick={() => show(b)}>Show files</button>
      </div>
      <ul>
        {#each b.items as it, i (i)}
          <li>
            <span class="mono">{it.from ? name(it.from) : '—'}</span> → <span class="mono">{name(it.to)}</span>
            {#if it.pending}
              <span class="pill warn">Unfinished</span>
            {:else if !it.ok}
              <span class="pill err">{it.reason ? REASONS[it.reason].title : 'Failed'}</span>
            {:else if it.reason}
              <span class="pill warn" title="The file was moved, but Undo can't put it back.">Done · can't be undone</span>
            {/if}
          </li>
        {/each}
      </ul>
    </details>
  {:else}
    <p class="hint">No batches yet.</p>
  {/each}
{:else}
  {#each entries as e, i (i)}
    <details class="item">
      <summary>
        <span class="pill {e.level === 'error' ? 'err' : e.level === 'warn' ? 'warn' : 'muted'}">{e.level}</span>
        <span class="what">{e.message}</span>
        <span class="meta">{when(e.t)} · {e.tool}{e.file ? ` · ${name(e.file)}` : ''}</span>
      </summary>
      {#if e.file}<p class="mono small">{e.file}</p>{/if}
      {#if e.detail}<pre class="mono small">{e.detail}</pre>{:else}<p class="hint">No technical details.</p>{/if}
    </details>
  {:else}
    <p class="hint">Nothing logged.</p>
  {/each}
{/if}

<style>
  .auto { width: auto; }
  .item { border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
  summary { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; cursor: pointer; }
  .what { font-weight: 500; }
  .meta { flex-basis: 100%; font-size: 12px; color: var(--text3); }
  ul { margin: 8px 0 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 4px; font-size: 12.5px; }
  .small { font-size: 12px; margin: 6px 0 0; white-space: pre-wrap; word-break: break-all; color: var(--text2); }
</style>
