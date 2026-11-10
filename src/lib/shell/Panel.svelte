<script lang="ts">
  import type { Snippet } from 'svelte';
  import { cubicOut } from 'svelte/easing';
  import { fly } from 'svelte/transition';
  import { motion } from './theme';

  let { title, onclose, children }: { title: string; onclose: () => void; children: Snippet } = $props();
  let box: HTMLElement;
  const opener = document.activeElement as HTMLElement | null;
  $effect(() => {
    box.focus();
    return () => opener?.focus();
  });

  /** Keeps Tab / Shift+Tab inside the page (the title bar stays clickable, so it is not inert). */
  function trap(e: KeyboardEvent) {
    if (e.key !== 'Tab') return;
    const items = [...box.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((el) => !el.hasAttribute('disabled'));
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    const a = document.activeElement;
    if (!box.contains(a) || a === box || (e.shiftKey ? a === first : a === last)) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
    }
  }
</script>

<svelte:window onkeydown={trap} />

<div
  class="page"
  role="dialog"
  aria-modal="true"
  aria-labelledby="panel-title"
  tabindex="-1"
  bind:this={box}
  transition:fly={{ y: 10, duration: motion(220), easing: cubicOut }}
>
  <div class="body">
    <div class="inner">
      <header>
        <h2 id="panel-title">{title}</h2>
        <button class="btn small" onclick={onclose}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          Close
        </button>
      </header>
      {@render children()}
    </div>
  </div>
</div>

<style>
  .page { position: fixed; inset: 60px 0 0 0; z-index: 10; display: flex; flex-direction: column; background: var(--bg); outline: none; }
  .body { flex: 1; overflow: auto; scrollbar-gutter: stable both-edges; user-select: text; }
  .inner { max-width: 880px; margin: 0 auto; padding: 22px 24px 28px; display: flex; flex-direction: column; gap: 14px; }
  header { display: flex; align-items: center; justify-content: space-between; padding-bottom: 4px; }
  h2 { font-size: 22px; }
</style>
