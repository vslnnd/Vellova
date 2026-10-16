<script lang="ts">
  import { revealItemInDir } from '@tauri-apps/plugin-opener';
  import { ui } from '../app.svelte';
  import { PDF } from '../rename/engine/files';
  import { applyFixes, pickPdf, plan, REASONS, retry, session, setName, skip } from '../rename/session.svelte';
  import { extOf, splitPath } from '../shared/names';
  import type { PlanItem, Reason } from '../shared/types';
  import { island } from '../shell/islandState.svelte';

  const TYPE: Reason[] = ['keyword-not-found', 'no-value', 'no-text'];
  const RETRY: Reason[] = ['locked', 'exists', 'internal'];
  const SHOW: Reason[] = ['permission', 'missing'];

  const groups = $derived.by(() => {
    const m = new Map<Reason, PlanItem[]>();
    for (const it of plan.items) if (it.status === 'attention' && it.reason) m.set(it.reason, [...(m.get(it.reason) ?? []), it]);
    return [...m];
  });
  const pdfs = $derived(plan.items.filter((i) => extOf(i.source) === PDF && i.name));
  const ready = $derived(plan.items.filter((i) => i.op && i.status !== 'attention' && session.fixed.includes(i.source)).length);
  const name = (p: string) => splitPath(p).name;

  function apply() {
    ui.panel = null;
    void applyFixes();
  }
</script>

{#if !groups.length}<p class="hint">Nothing needs attention.</p>{/if}

{#each groups as [reason, items] (reason)}
  <section class="card">
    <div class="row">
      <h3>{REASONS[reason].title} · {items.length}</h3>
      <span class="grow"></span>
      {#if RETRY.includes(reason)}<button class="btn small" onclick={() => items.forEach((i) => void retry(i.source))}>Retry all</button>{/if}
      <button class="btn small" onclick={() => items.forEach((i) => skip(i.source))}>Skip all</button>
    </div>
    <p class="hint">{REASONS[reason].hint}</p>
    {#if reason === 'exists' && session.rules.destination.mode === 'inplace' && session.rules.conflict === 'replace'}
      <p class="hint">If this drive has no Recycle Bin, Replace can't be used on it. Choose "Add (1)" or "Skip" for existing names in Rename, then Retry.</p>
    {/if}
    <ul>
      {#each items as it (it.id)}
        <li>
          <span class="mono file" title={it.source}>{name(it.source)}</span>
          {#if it.detail && it.detail !== REASONS[reason].hint}<span class="hint">{it.detail}</span>{/if}
          <div class="row">
            {#if TYPE.includes(reason)}
              <input class="field mono grow" placeholder="Type a name" aria-label="New name for {name(it.source)}" onchange={(e) => setName(it.source, e.currentTarget.value, true)} />
            {:else if reason === 'no-match'}
              <select class="field grow" aria-label="PDF for {name(it.source)}" onchange={(e) => e.currentTarget.value && pickPdf(it.source, e.currentTarget.value)}>
                <option value="">Pick its PDF…</option>
                {#each pdfs as p (p.id)}<option value={p.source}>{name(p.source)} → {p.name}</option>{/each}
              </select>
            {:else if RETRY.includes(reason)}
              <button class="btn small" onclick={() => void retry(it.source)}>Retry</button>
            {:else if SHOW.includes(reason)}
              <button class="btn small" onclick={() => void revealItemInDir(reason === 'missing' ? splitPath(it.source).dir : it.source).catch(() => {})}>Show in folder</button>
            {/if}
            <button class="btn small" onclick={() => skip(it.source)}>Skip</button>
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
