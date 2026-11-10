<script lang="ts">
  import { tick } from 'svelte';
  import { ipc } from '../shared/ipc';
  import { extOf, splitPath } from '../shared/names';
  import type { Position } from '../shared/types';
  import { findValue } from './engine/findValue';
  import { PDF } from './engine/files';
  import { classifyPdfError, type Item } from './engine/pdfItems';
  import { proposeLabel } from './engine/propose';
  import { hitChoices, ordinal } from './engine/steps';
  import { matchNo } from './engine/profile';
  import { openPage, readPdfText, type Word } from './pdf';
  import { stepView } from './RenameSettings.svelte';
  import { session } from './session.svelte';

  const POSITIONS: [Position, string][] = [['after', 'After'], ['before', 'Before'], ['below', 'Below'], ['above', 'Above']];

  const path = $derived(session.picking!);
  let bytes = $state<Uint8Array | null>(null);
  let items = $state<Item[]>([]);
  let error = $state('');
  let page = $state(1);
  let pages = $state(0);
  /** the page the drawn canvas and `words` belong to (lags `page` while the next one renders) */
  let shownPage = $state(0);
  let words = $state<Word[]>([]);
  /** the room for the page: the scroll area's inner size */
  let roomW = $state(0);
  let roomH = $state(0);
  // the page is drawn to fit the height (an A4 page is 1.414 times as tall as wide), between a readable minimum and the room there is
  const width = $derived(Math.max(0, Math.min(roomW - 28, Math.max(560, Math.min(820, (roomH - 24) / 1.414)))));

  /** the list's PDFs, for the previous and next file buttons */
  const pdfs = $derived(session.files.filter((f) => extOf(f.path) === PDF).map((f) => f.path));
  const at = $derived(pdfs.indexOf(path));
  /** files that could not be opened this time: the picker moves past them on its own */
  const failed = new Set<string>();
  const other = (by: number) => (session.picking = pdfs[at + by]);
  let canvas: HTMLCanvasElement;
  let kwInput = $state<HTMLInputElement>();

  let picked = $state<{ page: number; k: number } | null>(null);
  let keyword = $state('');
  let position = $state<Position>('after');
  let occurrence = $state(1);
  let notFound = $state(false);
  const gives = $derived(picked === null ? null : findValue(items, keyword.trim(), position, matchNo(occurrence)));

  // a new file: read it once (bytes for drawing, items for the proposal)
  $effect(() => {
    const p = path;
    bytes = null;
    items = [];
    error = '';
    page = 1;
    picked = null;
    [shownPage, words] = [0, []];
    let live = true;
    void (async () => {
      try {
        const b = await ipc.readFile(p);
        const text = await readPdfText(b.slice()); // the worker may take the buffer it is given
        if (!live) return;
        items = text.items;
        bytes = b;
      } catch (e) {
        if (!live) return;
        // an unreadable file is not worth a dead end: show the next PDF that might open
        failed.add(p);
        const next = pdfs.find((x) => !failed.has(x));
        if (next) session.picking = next;
        else error = classifyPdfError(e).detail;
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
          [pages, shownPage, words, error] = [r.pages, n, r.words, ''];
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
    const i = items.findIndex((it) => it.page === shownPage) + k;
    if (items[i]?.str !== words[k].str) return;
    const p = proposeLabel(items, i);
    picked = { page: shownPage, k };
    keyword = p?.keyword ?? '';
    position = p?.position ?? 'after';
    occurrence = p?.occurrence ?? 1;
    notFound = !p;
    await tick();
    document.querySelector('.picker .word.on')?.scrollIntoView({ block: 'nearest' }); // the proposal took room: keep the clicked value in view
    if (!p) kwInput?.focus();
  }

  /** The first PDF value step takes the proposal; without one, step 1 becomes one (a source step is replaced). */
  function use() {
    const steps = session.rules.steps;
    const from = session.pickStep;
    const at = from !== null && steps[from]?.type === 'pdfValue' ? from : steps.findIndex((s) => s.type === 'pdfValue');
    const old = steps[at];
    // a step that adds its value to the name keeps doing so
    const step = { type: 'pdfValue' as const, keyword: keyword.trim(), position, occurrence: matchNo(occurrence), ...(old?.type === 'pdfValue' && old.add ? { add: old.add } : {}) };
    if (at >= 0) steps[at] = step;
    else if (steps[0]?.type === 'pdfPattern' || steps[0]?.type === 'list') steps[0] = step;
    else steps.unshift(step);
    stepView.open = Math.max(at, 0); // the step it filled; a replaced or added source step is step 1
    void close();
  }

  /** Back to the preview, with focus on the bar button that opened the picker. */
  async function close() {
    session.picking = null;
    session.pickStep = null;
    await tick();
    document.querySelector<HTMLElement>('[data-part="pick"]')?.focus();
  }
</script>

<div class="card picker">
  <div class="row head">
    <h3 class="mono name" title={path}>{splitPath(path).name}</h3>
    {#if pdfs.length > 1}
      <button class="ib" aria-label="Previous file" title="Previous file" disabled={at <= 0} onclick={() => other(-1)}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
      </button>
      <button class="ib" aria-label="Next file" title="Next file" disabled={at < 0 || at >= pdfs.length - 1} onclick={() => other(1)}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
      </button>
    {/if}
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
    <button class="btn small" onclick={() => void close()}>Cancel</button>
  </div>
  <div class="main">
  <div class="scroll" bind:clientWidth={roomW} bind:clientHeight={roomH}>
    {#if error}<p class="err" role="alert">{error}</p>{/if}
    <div class="page" style:width="{width}px">
      <canvas bind:this={canvas}></canvas>
      {#each words as w, k (k)}
        <button
          class="word"
          class:on={picked?.page === shownPage && picked.k === k}
          aria-label={w.str}
          style="left:{w.box.left}px; top:{w.box.top}px; width:{w.box.width}px; height:{w.box.height}px"
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
        <label class="label wide" for="pk-hit">If found more than once</label>
        <select id="pk-hit" class="field" bind:value={occurrence}>
          {#each hitChoices(occurrence) as n (n)}<option value={n}>Use the {ordinal(n)}</option>{/each}
        </select>
      </div>
      <div class="row nowrap">
        <span class="gives mono grow">Gives: {gives?.ok ? gives.value : 'nothing'}</span>
        <button class="btn primary small" disabled={!keyword.trim()} onclick={use}>Use this</button>
      </div>
    </div>
  {/if}
  </div>
</div>

<style>
  .picker { flex: 1; min-width: 0; min-height: 0; padding: 0; gap: 0; }
  /* the page, and beside it (so the page keeps its height) what the click proposes */
  .main { flex: 1; min-height: 0; display: flex; }
  .head { padding: 12px 14px; border-bottom: 1px solid var(--border); flex-wrap: nowrap; }
  .name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
  .pages { font-variant-numeric: tabular-nums; white-space: nowrap; }
  .grow { flex: 1; min-width: 0; }
  .nowrap { flex-wrap: nowrap; }
  .ib { width: 28px; height: 28px; }
  .scroll { flex: 1; min-width: 0; min-height: 0; overflow: auto; scrollbar-gutter: stable; padding: 12px 14px; }
  .page { position: relative; margin: 0 auto; }
  canvas { display: block; background: #fff; box-shadow: 0 0 0 1px var(--border); }
  .word { position: absolute; padding: 0; border: 0; border-radius: 2px; background: transparent; cursor: pointer; }
  .word:hover, .word:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  .word.on { outline: 2px solid var(--accent); }
  .proposal { flex: 0 0 300px; display: flex; flex-direction: column; gap: 10px; padding: 14px; border-left: 1px solid var(--border); overflow: auto; }
  .proposal .seg { flex: 1 0 100%; display: grid; grid-template-columns: repeat(4, 1fr); }
  .proposal .seg button { padding: 0; }
  .wide { flex-basis: 100%; }
  .gives { font-size: 12.5px; color: var(--text2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .err { margin: 0 0 8px; font-size: 12px; color: var(--errink); }
</style>
