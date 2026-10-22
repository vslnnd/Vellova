<script lang="ts">
  import { splitPath } from '../shared/names';
  import type { Status } from '../shared/types';
  import type { Grid } from './engine/grid';
  import { headerInfo } from './engine/header';
  import type { SplitItem } from './engine/planner';
  import { clearFiles, pickFiles, pickFolder, plan, refresh, removeFile, session, skip } from './session.svelte';

  let { grids, onpick }: { grids: Record<string, Grid>; onpick: (file: string) => void } = $props();

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
  let open = $state<string | null>(null);

  /** Each listed file with its own notes (a read error, a failed archive) and its outputs, in list order. */
  const groups = $derived(
    session.files.map((f) => {
      const its = plan.items.filter((i) => i.source === f.path);
      return { path: f.path, notes: its.filter((i) => i.id === i.source || i.id.startsWith('archive:')), outs: its.filter((i) => i.id !== i.source && !i.id.startsWith('archive:')) };
    }),
  );
  const warnings = (path: string) => (grids[path] && session.rules.mode !== 'sheets' ? headerInfo(grids[path], session.rules.header).warnings : []);
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

  /** The first 20 rows of an output, as the preview table shows them. */
  function sample(it: SplitItem): { head: string[]; rows: string[][]; note?: string } {
    const g = grids[it.source];
    const spec = it.spec;
    if (!g || !spec) return { head: [], rows: [] };
    if (spec.kind === 'summary') return { head: ['Person', 'Rows', 'Groups', 'Share'], rows: spec.summary.slice(0, 20).map((s) => [s.person, String(s.rows), String(s.groups), `${s.share}%`]) };
    if (spec.kind === 'sheet') {
      if (spec.sheet !== g.sheet) return { head: [], rows: [], note: 'Only the selected sheet is read for the preview.' };
      return { head: g.rows[0] ?? [], rows: g.rows.slice(1, 21) };
    }
    const head = g.rows[headerInfo(g, session.rules.header).row] ?? [];
    const picked = spec.rows.slice(0, 20).map((r) => g.rows[r]);
    const width = Math.max(head.length, ...picked.map((r) => r.length));
    const pad = (r: string[]) => [...r, ...Array(width - r.length).fill('')];
    const rows = picked.map((r, k) => (spec.assigned ? [...pad(r), spec.assigned[spec.rows[k]] ?? ''] : pad(r)));
    return { head: spec.assigned ? [...pad(head), 'Assigned to'] : pad(head), rows };
  }
</script>

<div class="card preview">
  <div class="row head">
    <h3>{plural(session.files.length, 'file', 'files')}</h3>
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
  <div class="list">
    {#each groups as g (g.path)}
      <section class="src">
        <div class="row">
          <span class="name mono" title={g.path}>{nameOf(g.path)}</span>
          {#if g.outs.length}<span class="hint">{plural(g.outs.length, 'output', 'outputs')}</span>{/if}
          <span class="grow"></span>
          {#each g.notes as n (n.id)}
            {#if n.id === n.source}
              {@const [tone, label] = PILL[n.status]}<span class="pill {tone}">{label}</span>
              {#if n.status !== 'pending'}
                <button class="ib" title={n.status === 'skipped' ? 'Include' : 'Skip'} aria-label="{n.status === 'skipped' ? 'Include' : 'Skip'} {nameOf(g.path)}" onclick={() => skip(n.id)}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M5.6 5.6l12.8 12.8" /></svg>
                </button>
              {/if}
            {/if}
          {/each}
          <button class="ib" title="Remove from the list" aria-label="Remove {nameOf(g.path)}" onclick={() => removeFile(g.path)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        {#each g.notes as n (n.id)}
          {#if n.detail}<p class="why" class:err={n.status === 'attention'}>{n.id.startsWith('archive:') ? `Archive: ${n.detail}` : n.detail}</p>{/if}
        {/each}
        {#each warnings(g.path) as w (w)}
          <div class="banner">
            <span>{w}</span>
            <span class="grow"></span>
            <button class="btn small" onclick={() => onpick(g.path)}>Choose header row</button>
          </div>
        {/each}
        {#if g.outs.length}
          <div class="outs">
            {#each g.outs as it (it.id)}
              {@const [tone, label] = PILL[it.status]}
              <div class="out" class:dim={it.status === 'skipped'} class:on={open === it.id}>
                <button class="open" aria-expanded={open === it.id} onclick={() => (open = open === it.id ? null : it.id)}>
                  <span class="oname mono" title={it.name}>{it.name ?? 'No name'}</span>
                  <span class="meta">
                    {plural(it.rows, 'row', 'rows')}{#if it.label !== undefined}{` · ${it.label}`}{/if}{#if it.share !== undefined}{` · ${it.share}%`}{/if}
                  </span>
                  <span class="pill {tone}">{label}</span>
                </button>
                <button class="ib" title={it.status === 'skipped' ? 'Include' : 'Skip'} aria-label="{it.status === 'skipped' ? 'Include' : 'Skip'} {it.name}" onclick={() => skip(it.id)}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M5.6 5.6l12.8 12.8" /></svg>
                </button>
                {#if it.detail && it.status !== 'ready'}<span class="why">{it.detail}</span>{/if}
              </div>
            {/each}
          </div>
          {@const shown = g.outs.find((i) => i.id === open)}
          {#if shown}
            {@const s = sample(shown)}
            <div class="table">
              {#if s.note}<p class="hint pad">{s.note}</p>{:else}
                <table class="mono">
                  <thead><tr>{#each s.head as h, c (c)}<th>{h}</th>{/each}</tr></thead>
                  <tbody>{#each s.rows as r, i (i)}<tr>{#each r as v, c (c)}<td title={v}>{v}</td>{/each}</tr>{/each}</tbody>
                </table>
              {/if}
            </div>
            {#if shown.rows > 20}<p class="hint">The first 20 of {shown.rows} rows.</p>{/if}
          {/if}
        {/if}
      </section>
    {/each}
  </div>
</div>

<style>
  .preview { flex: 1; min-height: 0; padding: 0; gap: 0; }
  .head { padding: 12px 14px; border-bottom: 1px solid var(--border); }
  .grow { flex: 1; }
  .list { overflow: auto; flex: 1; padding: 4px 0; }
  .src { display: flex; flex-direction: column; gap: 6px; padding: 10px 14px; border-bottom: 1px solid var(--border); }
  .src:last-child { border-bottom: 0; }
  .src > .row { flex-wrap: nowrap; }
  .name { font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .why { margin: 0; font-size: 12px; color: var(--text3); }
  .why.err { color: var(--errink); }
  .banner { display: flex; align-items: center; gap: 8px; padding: 6px 6px 6px 10px; border-radius: 6px; background: var(--warnsoft); color: var(--warnink); font-size: 12.5px; }
  .outs { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 6px; }
  .out { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); padding-right: 2px; }
  .out.on { border-color: var(--accent); }
  .out.dim { opacity: 0.65; }
  .out .why { grid-column: 1 / -1; padding: 0 10px 6px; }
  .open { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px 8px; align-items: center; padding: 7px 10px; border: 0; border-radius: 6px; background: transparent; text-align: left; min-width: 0; }
  .open:hover { background: var(--hover); }
  .oname { font-size: 12.5px; overflow-wrap: anywhere; }
  .meta { grid-column: 1; font-size: 12px; color: var(--text3); font-variant-numeric: tabular-nums; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .open .pill { grid-row: 1 / span 2; grid-column: 2; }
  .ib { width: 28px; height: 28px; }
  .table { align-self: flex-start; max-width: 100%; overflow: auto; max-height: 320px; border: 1px solid var(--border); border-radius: 6px; }
  .pad { padding: 10px; }
  table { border-collapse: collapse; font-size: 12px; }
  th, td { padding: 4px 8px; border-bottom: 1px solid var(--border); text-align: left; white-space: nowrap; max-width: 200px; overflow: hidden; text-overflow: ellipsis; }
  th { position: sticky; top: 0; background: var(--surface2); color: var(--text2); font-weight: 500; }
</style>
