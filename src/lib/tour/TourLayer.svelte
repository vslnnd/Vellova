<script lang="ts">
  import { revealItemInDir } from '@tauri-apps/plugin-opener';
  import { tick } from 'svelte';
  import { scale } from 'svelte/transition';
  import { join } from '../shared/names';
  import { data, save } from '../shared/state.svelte';
  import { motion } from '../shell/theme';
  import { counted, FIRST_SAMPLE, STEPS } from './steps';
  import { addSamples, beginSamples, endTour, next, startTour, tour, view } from './tour.svelte';
  import Welcome from './Welcome.svelte';

  const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea, [tabindex]:not([tabindex="-1"])';
  const PAD = 6;
  const BUBBLE = 340;

  let vw = $state(innerWidth);
  let vh = $state(innerHeight);
  let rect = $state<{ x: number; y: number; w: number; h: number } | null>(null);
  let stuck = $state(false);
  let confirm = $state(false);
  let box = $state<HTMLElement>(); // the card or the hint bubble

  const step = $derived(tour.step >= 0 ? STEPS[tour.step] : undefined);
  const card = $derived(tour.card ?? (step && !step.target ? step.id : null));
  const on = $derived(tour.card !== null || tour.step >= 0);
  const v = $derived(view());
  const lost = $derived(step?.lost?.(v) ?? null);
  const n = $derived(step ? counted.indexOf(step) + 1 : 0);
  const below = $derived(!rect || rect.y + rect.h + 190 < vh);
  // a target too tall for the bubble on either side (the drop zone) gets it inside its top edge
  const above = $derived(!below && !!rect && rect.y - 190 > 0);
  const bubbleLeft = $derived(rect ? Math.min(Math.max(rect.x + rect.w / 2 - BUBBLE / 2, 16), vw - BUBBLE - 16) : vw / 2 - BUBBLE / 2);
  const bubbleTop = $derived(!rect ? vh / 2 : below ? rect.y + rect.h + PAD + 40 : above ? rect.y - PAD - 40 : rect.y + PAD + 16);

  const target = () => (step?.target ? document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`) : null);

  // a step that waits for something ends when it happens
  $effect(() => {
    if (step && typeof step.done === 'function' && step.done(v)) next();
  });

  // ponytail: follows the target with one rect read per frame instead of Resize/Mutation/scroll observers
  $effect(() => {
    const id = step?.target;
    if (!id || card) {
      rect = null;
      stuck = false;
      return;
    }
    const since = performance.now();
    let raf = 0;
    const loop = () => {
      const el = target();
      const seen = !!el && el.checkVisibility({ opacityProperty: true, visibilityProperty: true });
      const r = seen ? el!.getBoundingClientRect() : null;
      if (!r) rect = null;
      else if (!rect || rect.x !== r.x || rect.y !== r.y || rect.w !== r.width || rect.h !== r.height) rect = { x: r.x, y: r.y, w: r.width, h: r.height };
      stuck = !seen && performance.now() - since > 5000;
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  });

  // each step starts with the focus where the user acts: Next, or the target itself
  $effect(() => {
    void tour.step;
    void tour.card;
    confirm = false;
    void tick().then(() => {
      const t = target();
      const into = card || step?.done === 'next' || !t
        ? box?.querySelector<HTMLElement>('[data-first], .primary')
        : t.matches(FOCUSABLE) ? t : t.querySelector<HTMLElement>(FOCUSABLE);
      into?.focus();
    });
  });

  /** Clicks reach only the card or bubble, the target, the window controls and the drag region itself. */
  function allowed(t: EventTarget | null): boolean {
    if (!(t instanceof Element)) return false;
    if (box?.contains(t) || t.closest('[data-tour-free]') || t.hasAttribute('data-tauri-drag-region')) return true;
    const tg = card ? null : target();
    return !!tg && tg.contains(t);
  }

  function cycle(back: boolean) {
    const tg = card ? null : target();
    const own = tg ? (tg.matches(FOCUSABLE) ? [tg] : [...tg.querySelectorAll<HTMLElement>(FOCUSABLE)]) : [];
    const items = [...own, ...(box ? box.querySelectorAll<HTMLElement>(FOCUSABLE) : [])];
    if (!items.length) return;
    const i = items.indexOf(document.activeElement as HTMLElement);
    items[i < 0 ? 0 : (i + (back ? -1 : 1) + items.length) % items.length].focus();
  }

  function welcomed() {
    data.settings.welcomed = true;
    save('settings');
  }
  function tryIt() {
    welcomed();
    startTour();
  }
  function skipWelcome() {
    welcomed();
    tour.card = null;
  }
  function escape() {
    if (tour.card === 'welcome') skipWelcome();
    else if (tour.card === 'resume') tour.card = null;
    else if (card) void endTour(); // Start (nothing made yet) or Done: the card's own way out, nothing to confirm
    else ask(!confirm);
  }
  /** Opens or closes "Skip the tour?" and keeps the focus on its row (Keep going, or Skip tour again). */
  function ask(on: boolean) {
    confirm = on;
    void tick().then(() => box?.querySelector<HTMLElement>(on ? '[data-keep]' : '[data-ask]')?.focus());
  }

  $effect(() => {
    if (!on) return;
    const block = (e: Event) => {
      if (!allowed(e.target)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' && e.key !== 'Tab') return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') escape();
      else cycle(e.shiftKey);
    };
    const kinds = ['pointerdown', 'mousedown', 'click', 'dblclick', 'auxclick', 'contextmenu'];
    kinds.forEach((k) => addEventListener(k, block, true));
    addEventListener('keydown', key, true);
    return () => {
      kinds.forEach((k) => removeEventListener(k, block, true));
      removeEventListener('keydown', key, true);
    };
  });
</script>

<svelte:window bind:innerWidth={vw} bind:innerHeight={vh} />

{#snippet rich(text: string)}{#each text.split('`') as part, i (i)}{#if i % 2}<code class="mono">{part}</code>{:else}{part}{/if}{/each}{/snippet}

{#if on}
  <div class="tour">
    {#if card}
      <div class="blur" aria-hidden="true"></div>
      <div class="tcard" role="dialog" aria-modal="true" aria-labelledby="tour-title" bind:this={box} transition:scale={{ start: 0.96, duration: motion(220) }}>
        {#if card === 'welcome'}
          <Welcome onstart={tryIt} onskip={skipWelcome} />
        {:else if card === 'resume'}
          <h2 id="tour-title">Resume the tour?</h2>
          <p>The tour stopped when Vellova closed. Its sample files were cleaned up.</p>
          <div class="row">
            <button class="btn primary" onclick={startTour}>Resume</button>
            <button class="btn" onclick={() => (tour.card = null)}>No thanks</button>
          </div>
        {:else if step}
          <h2 id="tour-title">{step.title}</h2>
          <p>{@render rich(step.text)}</p>
          {#if tour.error}<p class="err" role="alert">{tour.error}</p>{/if}
          <div class="row">
            {#if step.id === 'start'}
              <button class="btn primary" disabled={tour.preparing} onclick={() => void beginSamples()}>Start</button>
              <button class="btn" onclick={() => void endTour()}>Skip tour</button>
            {:else}
              <button class="btn primary" onclick={() => void endTour()}>Finish</button>
            {/if}
          </div>
        {/if}
      </div>
    {:else if step}
      <svg class="veil" aria-hidden="true" width={vw} height={vh}>
        <defs>
          <mask id="tour-hole">
            <rect width={vw} height={vh} fill="white" />
            {#if rect}
              <rect class="hole" rx="12" fill="black" style:x="{rect.x - PAD}px" style:y="{rect.y - PAD}px" style:width="{rect.w + PAD * 2}px" style:height="{rect.h + PAD * 2}px" />
            {/if}
          </mask>
        </defs>
        <rect width={vw} height={vh} fill="var(--veil)" mask="url(#tour-hole)" />
      </svg>
      {#if rect}
        <div class="ring" aria-hidden="true" style:left="{rect.x - PAD}px" style:top="{rect.y - PAD}px" style:width="{rect.w + PAD * 2}px" style:height="{rect.h + PAD * 2}px"></div>
        <svg class="arrow" class:flip={!below} aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" style:left="{rect.x + rect.w / 2 - 12}px" style:top="{below ? rect.y + rect.h + PAD + 8 : rect.y - PAD - 32}px">
          <path d="M12 20V5M6 11l6-6 6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      {/if}
      <div class="bubble" class:above role="dialog" aria-modal="true" aria-label="Tour, step {n} of {counted.length}" bind:this={box} style:left="{bubbleLeft}px" style:top="{bubbleTop}px" style:width="{BUBBLE}px">
        {#if lost}<p class="lost">{@render rich(lost)}</p>{/if}
        <p aria-live="polite">{@render rich(step.text)}</p>
        {#if step.id === 'drop' || (lost && v.samples === 0)}
          <div class="row">
            <button class="btn small" onclick={() => void revealItemInDir(join(tour.dir, FIRST_SAMPLE))}>Open the folder</button>
            <button class="btn small" onclick={() => void addSamples()}>Add them for me</button>
          </div>
        {/if}
        <div class="row">
          {#if confirm}
            <span class="q">Skip the tour?</span>
            <span class="grow"></span>
            <button class="btn small" data-keep onclick={() => ask(false)}>Keep going</button>
            <button class="btn small primary" onclick={() => void endTour()}>Skip</button>
          {:else}
            <span class="count">{n} of {counted.length}</span>
            <span class="grow"></span>
            <button class="btn small" data-ask onclick={() => ask(true)}>Skip tour</button>
            {#if stuck || v.error}<button class="btn small" onclick={next}>Skip this step</button>{/if}
            {#if step.done === 'next'}<button class="btn small primary" onclick={next}>Next</button>{/if}
          {/if}
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  .tour { position: fixed; inset: 0; z-index: 1000; pointer-events: none; }
  .blur { position: absolute; inset: 0; background: var(--veil); backdrop-filter: blur(6px); }
  .veil { position: absolute; left: 0; top: 0; }
  .hole { transition: x 300ms ease-out, y 300ms ease-out, width 300ms ease-out, height 300ms ease-out; }
  .ring {
    position: absolute; border-radius: 12px; box-shadow: 0 0 0 2px var(--accent), 0 0 10px 2px var(--soft);
    animation: ring 1.6s ease-in-out infinite; transition: left 300ms ease-out, top 300ms ease-out, width 300ms ease-out, height 300ms ease-out;
  }
  .arrow { position: absolute; color: var(--accent); animation: bob 1.2s ease-in-out infinite; transition: left 300ms ease-out, top 300ms ease-out; }
  .arrow.flip { rotate: 180deg; animation-name: bobdown; }
  .tcard, .bubble {
    position: absolute; pointer-events: auto; display: flex; flex-direction: column; gap: 12px;
    background: var(--surface); border: 1px solid var(--border2); border-radius: 14px; box-shadow: var(--shadow);
  }
  .tcard { left: 50%; top: 50%; translate: -50% -50%; width: min(540px, 100vw - 48px); padding: 24px 26px; }
  .tcard :global(h2) { font-size: 20px; }
  .bubble { padding: 14px 16px; gap: 10px; transition: left 300ms ease-out, top 300ms ease-out; }
  .bubble.above { translate: 0 -100%; }
  p { margin: 0; }
  code { padding: 1px 5px; border-radius: 5px; background: var(--soft); color: var(--accent); font-size: 0.95em; }
  .lost { color: var(--warnink); }
  .err { color: var(--errink); }
  .count, .q { font-size: 12.5px; color: var(--text2); font-variant-numeric: tabular-nums; }
  .grow { flex: 1; }
  @keyframes ring {
    0%, 100% { box-shadow: 0 0 0 2px var(--accent), 0 0 10px 2px var(--soft); }
    50% { box-shadow: 0 0 0 3px var(--accent), 0 0 26px 8px var(--soft); }
  }
  @keyframes bob { 0%, 100% { translate: 0 0; } 50% { translate: 0 -6px; } }
  @keyframes bobdown { 0%, 100% { translate: 0 0; } 50% { translate: 0 6px; } }
  @media (prefers-reduced-motion: reduce) {
    .ring, .arrow { animation: none; }
    .hole, .ring, .arrow, .bubble { transition: none; }
  }
</style>
