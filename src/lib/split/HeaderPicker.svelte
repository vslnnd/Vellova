<script lang="ts">
  import { splitPath } from '../shared/names';
  import type { Grid } from './engine/grid';
  import { colLetter } from './engine/header';
  import { session } from './session.svelte';

  let { open = $bindable(), file = $bindable(), grids }: { open: boolean; file: string; grids: Record<string, Grid> } = $props();

  let dialog: HTMLDialogElement;
  const path = $derived(session.files.some((f) => f.path === file) ? file : (session.files[0]?.path ?? ''));
  const grid = $derived(grids[path]);
  const rows = $derived(grid?.rows.slice(0, 15) ?? []);
  const width = $derived(Math.max(1, ...rows.map((r) => r.length)));
  const chosen = $derived(session.rules.header.mode === 'manual' ? session.rules.header.row : 1);

  $effect(() => {
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  });

  const pick = (i: number) => (session.rules.header = { mode: 'manual', row: i + 1 });
  function onkey(e: KeyboardEvent, i: number) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    pick(i);
  }
</script>

<dialog bind:this={dialog} class="card" aria-labelledby="hp-title" onclose={() => (open = false)}>
  <div class="row">
    <h2 id="hp-title">Choose the header row</h2>
    <span class="grow"></span>
    <button class="btn small primary" onclick={() => (open = false)}>Done</button>
  </div>
  {#if session.files.length > 1}
    <select class="field" aria-label="File" value={path} onchange={(e) => (file = e.currentTarget.value)}>
      {#each session.files as f (f.path)}<option value={f.path}>{splitPath(f.path).name}</option>{/each}
    </select>
  {/if}
  <div class="scroll">
    {#if !grid}
      <p class="hint pad">{!path ? 'Add a file to see its rows.' : session.loading ? 'Reading…' : "This file couldn't be read."}</p>
    {:else}
      <table class="mono">
        <thead>
          <tr><th></th>{#each { length: width } as _, c (c)}<th>{colLetter(c)}</th>{/each}</tr>
        </thead>
        <tbody>
          {#each rows as r, i (i)}
            <tr tabindex="0" aria-current={chosen === i + 1 ? 'true' : undefined} class:on={chosen === i + 1} onclick={() => pick(i)} onkeydown={(e) => onkey(e, i)}>
              <th>{i + 1}</th>
              {#each { length: width } as _, c (c)}<td title={r[c] ?? ''}>{r[c] ?? ''}</td>{/each}
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </div>
  <p class="hint">Header row: {chosen}</p>
</dialog>

<style>
  dialog { width: min(880px, calc(100vw - 48px)); max-height: calc(100vh - 96px); color: var(--text); box-shadow: var(--shadow); padding: 16px; }
  dialog:not([open]) { display: none; }
  dialog::backdrop { background: var(--veil); }
  .grow { flex: 1; }
  .scroll { overflow: auto; min-height: 0; border: 1px solid var(--border); border-radius: 6px; }
  .pad { padding: 12px; }
  table { border-collapse: collapse; font-size: 12px; }
  th, td { padding: 4px 8px; border-bottom: 1px solid var(--border); text-align: left; white-space: nowrap; }
  td { max-width: 180px; overflow: hidden; text-overflow: ellipsis; }
  th { color: var(--text3); font-weight: 500; background: var(--surface2); position: sticky; top: 0; }
  tbody th { position: sticky; left: 0; }
  tbody tr { cursor: pointer; }
  tbody tr:hover { background: var(--hover); }
  tbody tr:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  tbody tr.on { background: var(--soft); }
  tbody tr.on th { color: var(--accent); }
</style>
