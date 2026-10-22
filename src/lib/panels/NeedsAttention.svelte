<script lang="ts">
  import { revealItemInDir } from '@tauri-apps/plugin-opener';
  import { ui } from '../app.svelte';
  import { PDF } from '../rename/engine/files';
  import * as rename from '../rename/session.svelte';
  import { REASONS } from '../shared/reasons';
  import { headerInfo } from '../split/engine/header';
  import * as split from '../split/session.svelte';
  import { extOf, splitPath } from '../shared/names';
  import type { PlanItem, Reason } from '../shared/types';
  import { island } from '../shell/islandState.svelte';

  const TYPE: Reason[] = ['keyword-not-found', 'no-value', 'no-text'];
  const RETRY: Reason[] = ['locked', 'exists', 'internal'];
  const SHOW: Reason[] = ['permission', 'missing'];

  const isSplit = $derived(ui.tool === 'split');
  const tool = $derived(isSplit ? split : rename);
  const session = $derived(tool.session);
  /** Rename acts on a file's path, Split on an item's id (a file, one output or a failed archive). */
  const key = (it: PlanItem) => (isSplit ? it.id : it.source);
  const groups = $derived.by(() => {
    const m = new Map<Reason, PlanItem[]>();
    for (const it of tool.plan.items) if (it.status === 'attention' && it.reason) m.set(it.reason, [...(m.get(it.reason) ?? []), it]);
    return [...m];
  });
  const pdfs = $derived(rename.plan.items.filter((i) => extOf(i.source) === PDF && i.name));
  const ready = $derived(
    isSplit
      ? split.session.fixed.length
      : rename.plan.items.filter((i) => i.op && i.status !== 'attention' && rename.session.fixed.includes(i.source)).length,
  );
  /** The column names of a split file, for "Choose column for this file". */
  const columns = (path: string) => {
    const r = split.session.reads[path];
    return r?.ok ? headerInfo(r.grid, split.session.rules.header).columns.map((c) => c.name).filter((n) => n.trim()) : [];
  };
  const name = (p: string) => splitPath(p).name;

  function apply() {
    ui.panel = null;
    void tool.applyFixes();
  }
</script>

{#if !groups.length}<p class="hint">Nothing needs attention.</p>{/if}

{#each groups as [reason, items] (reason)}
  <section class="card">
    <div class="row">
      <h3>{REASONS[reason].title} · {items.length}</h3>
      <span class="grow"></span>
      {#if RETRY.includes(reason)}<button class="btn small" disabled={!!island.activity} onclick={() => items.forEach((i) => void tool.retry(key(i)))}>Retry all</button>{/if}
      <button class="btn small" onclick={() => items.forEach((i) => tool.skip(key(i)))}>Skip all</button>
    </div>
    <p class="hint">{REASONS[reason].hint}</p>
    {#if reason === 'exists' && session.rules.conflict === 'replace'}
      <p class="hint">If this drive has no Recycle Bin, Replace can't be used on it. Choose "Add (1)" or "Skip" for existing names in {isSplit ? 'Split' : 'Rename'}, then Retry.</p>
    {/if}
    <ul>
      {#each items as it (it.id)}
        <li>
          <span class="mono file" title={it.source}>{name(it.source)}</span>
          {#if it.detail && it.detail !== REASONS[reason].hint}<span class="hint">{it.detail}</span>{/if}
          <div class="row">
            {#if TYPE.includes(reason)}
              <input class="field mono grow" placeholder="Type a name" aria-label="New name for {name(it.source)}" onchange={(e) => rename.setName(it.source, e.currentTarget.value, true)} />
            {:else if reason === 'no-match'}
              <select class="field grow" aria-label="PDF for {name(it.source)}" onchange={(e) => e.currentTarget.value && rename.pickPdf(it.source, e.currentTarget.value)}>
                <option value="">Pick its PDF…</option>
                {#each pdfs as p (p.id)}<option value={p.source}>{name(p.source)} → {p.name}</option>{/each}
              </select>
            {:else if reason === 'no-column'}
              <select class="field grow" aria-label="Column for {name(it.source)}" onchange={(e) => e.currentTarget.value && split.setColumn(it.source, e.currentTarget.value)}>
                <option value="">Choose column for this file…</option>
                {#each columns(it.source) as c (c)}<option value={c}>{c}</option>{/each}
              </select>
            {:else if RETRY.includes(reason)}
              <button class="btn small" disabled={!!island.activity} onclick={() => void tool.retry(key(it))}>Retry</button>
            {:else if SHOW.includes(reason)}
              <button class="btn small" onclick={() => void revealItemInDir(reason === 'missing' ? splitPath(it.source).dir : it.source).catch(() => {})}>Show in folder</button>
            {/if}
            <button class="btn small" onclick={() => tool.skip(key(it))}>Skip</button>
          </div>
        </li>
      {/each}
    </ul>
  </section>
{/each}

<div class="row foot">
  <span class="hint">{ready ? `${ready} fixed ${ready === 1 ? 'file is' : 'files are'} ready.` : 'Fix files above, then apply them.'}</span>
  <span class="grow"></span>
  <button class="btn primary" disabled={!ready || session.busy || session.loading || session.dirty || !!island.activity} onclick={apply}>Apply fixes</button>
</div>

<style>
  ul { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 10px; }
  li { display: flex; flex-direction: column; gap: 4px; }
  .file { font-size: 12.5px; }
  .grow { flex: 1; min-width: 0; }
  .foot { position: sticky; bottom: -24px; padding: 12px 0; background: var(--surface); border-top: 1px solid var(--border); }
</style>
