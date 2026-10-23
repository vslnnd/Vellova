<script lang="ts">
  import { tick } from 'svelte';
  import { ipc } from '../shared/ipc';
  import { splitPath } from '../shared/names';
  import type { Position } from '../shared/types';
  import { findValue } from './engine/findValue';
  import { classifyPdfError, type Item } from './engine/pdfItems';
  import { proposeLabel } from './engine/propose';
  import { matchNo } from './engine/profile';
  import { openPage, readPdfText, type Word } from './pdf';
  import { session } from './session.svelte';

  const POSITIONS: [Position, string][] = [['after', 'After'], ['before', 'Before'], ['below', 'Below'], ['above', 'Above']];

  const path = $derived(session.picking!);
  let bytes = $state<Uint8Array | null>(null);
  let items = $state<Item[]>([]);
  let error = $state('');
  let page = $state(1);
  let pages = $state(0);
  let scale = $state(1);
  let words = $state<Word[]>([]);
  let width = $state(0);
  let canvas: HTMLCanvasElement;
  let kwInput = $state<HTMLInputElement>();

  let picked = $state<{ page: number; k: number } | null>(null);
  let keyword = $state('');
  let position = $state<Position>('after');
  let occurrence = $state(1);
  let notFound = $state(false);
  const gives = $derived(picked === null ? null : findValue(items, keyword, position, matchNo(occurrence)));

  // a new file: read it once (bytes for drawing, items for the proposal)
  $effect(() => {
    const p = path;
    bytes = null;
    items = [];
    error = '';
    page = 1;
    picked = null;
    let live = true;
    void (async () => {
      try {
        const b = await ipc.readFile(p);
        const text = await readPdfText(b.slice()); // the worker may take the buffer it is given
        if (!live) return;
        items = text.items;
        bytes = b;
      } catch (e) {
        if (live) error = classifyPdfError(e).detail;
      }
    })();
    return () => (live = false);
  });

  // draw the page at the column width; one render at a time on the canvas, the newest wins
  let queue = Promise.resolve();
  $effect(() => {
    const [b, n, w] = [bytes, page, Math.floor(width)];
    if (!b || !w) return;
    let live = true;
    const t = setTimeout(() => {
      queue = queue.then(async () => {
        if (!live) return;
        try {
          const r = await openPage(b.slice(), n, canvas, w);
          if (!live) return;
          [pages, scale, words] = [r.pages, r.scale, r.words];
        } catch (e) {
          if (live) error = classifyPdfError(e).detail;
        }
      });
    }, 100);
    return () => {
      live = false;
      clearTimeout(t);
    };
  });

  async function pick(k: number) {
    // word k of the page is the page's k-th item (openPage lists them as extractItems does)
    const i = items.findIndex((it) => it.page === page) + k;
    if (items[i]?.str !== words[k].str) return;
    const p = proposeLabel(items, i);
    picked = { page, k };
    keyword = p?.keyword ?? '';
    position = p?.position ?? 'after';
    occurrence = p?.occurrence ?? 1;
    notFound = !p;
    if (p) return;
    await tick();
    kwInput?.focus();
  }

  /** The first PDF value step takes the proposal; without one, step 1 becomes one (a source step is replaced). */
  function use() {
    const step = { type: 'pdfValue' as const, keyword: keyword.trim(), position, occurrence: matchNo(occurrence) };
    const steps = session.rules.steps;
    const at = steps.findIndex((s) => s.type === 'pdfValue');
    if (at >= 0) steps[at] = step;
    else if (steps[0]?.type === 'pdfPattern' || steps[0]?.type === 'list') steps[0] = step;
    else steps.unshift(step);
    session.picking = null;
  }
</script>

<div class="card picker">
  <div class="row head">
    <h3 class="mono name" title={path}>{splitPath(path).name}</h3>
    <span class="grow"></span>
    {#if pages > 1}
      <button class="ib" aria-label="Previous page" disabled={page <= 1} onclick={() => page--}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
      </button>
      <span class="hint pages">{page} of {pages}</span>
      <button class="ib" aria-label="Next page" disabled={page >= pages} onclick={() => page++}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
      </button>
    {/if}
    <button class="btn small" onclick={() => (session.picking = null)}>Cancel</button>
  </div>
  <div class="scroll">
    {#if error}<p class="err" role="alert">{error}</p>{/if}
    <div class="page" bind:clientWidth={width}>
      <canvas bind:this={canvas}></canvas>
      {#each words as w, k (k)}
        <button
          class="word"
          class:on={picked?.page === page && picked.k === k}
          aria-label={w.str}
          style="left:{w.x * scale}px; top:{(w.y - w.h) * scale}px; width:{w.w * scale}px; height:{w.h * scale}px"
          onclick={() => void pick(k)}
        ></button>
      {/each}
    </div>
  </div>
  {#if picked !== null}
    <div class="proposal">
      <label class="label" for="pk-kw">Keyword</label>
      <div class="row nowrap">
        <input id="pk-kw" class="field mono grow" spellcheck="false" bind:this={kwInput} bind:value={keyword} />
        {#if notFound && !keyword.trim()}<span class="hint">No label found</span>{/if}
      </div>
      <div class="row">
        <div class="seg" role="group" aria-label="Position">
          {#each POSITIONS as [v, label] (v)}
            <button aria-pressed={position === v} onclick={() => (position = v)}>{label}</button>
          {/each}
        </div>
        <label class="inline">Match number <input class="field num" type="number" min="1" max="99" bind:value={occurrence} /></label>
      </div>
      <div class="row nowrap">
        <span class="gives mono grow">Gives: {gives?.ok ? gives.value : 'nothing'}</span>
        <button class="btn primary small" disabled={!keyword.trim()} onclick={use}>Use this</button>
      </div>
    </div>
  {/if}
</div>

<style>
  .picker { flex: 1; min-height: 0; padding: 0; gap: 0; }
  .head { padding: 12px 14px; border-bottom: 1px solid var(--border); flex-wrap: nowrap; }
  .name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
  .pages { font-variant-numeric: tabular-nums; white-space: nowrap; }
  .grow { flex: 1; min-width: 0; }
  .nowrap { flex-wrap: nowrap; }
  .ib { width: 28px; height: 28px; }
  .scroll { flex: 1; min-height: 0; overflow: auto; scrollbar-gutter: stable; padding: 12px 14px; }
  .page { position: relative; width: 100%; }
  canvas { display: block; background: #fff; box-shadow: 0 0 0 1px var(--border); }
  .word { position: absolute; padding: 0; border: 0; border-radius: 2px; background: transparent; cursor: pointer; }
  .word:hover, .word:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  .word.on { outline: 2px solid var(--accent); }
  .proposal { display: flex; flex-direction: column; gap: 8px; padding: 12px 14px; border-top: 1px solid var(--border); }
  .num { width: 64px; }
  .gives { font-size: 12.5px; color: var(--text2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .err { margin: 0 0 8px; font-size: 12px; color: var(--errink); }
</style>
