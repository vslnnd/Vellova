<script lang="ts">
  import type { Snippet } from 'svelte';
  import { cubicOut } from 'svelte/easing';
  import { fade, fly } from 'svelte/transition';
  import { motion } from './theme';

  let { title, onclose, children }: { title: string; onclose: () => void; children: Snippet } = $props();
  let box: HTMLElement;
  $effect(() => box.focus());
</script>

<button class="scrim" tabindex="-1" aria-label="Close {title}" onclick={onclose} transition:fade={{ duration: motion(180) }}></button>
<div
  class="panel"
  role="dialog"
  aria-modal="true"
  aria-labelledby="panel-title"
  tabindex="-1"
  bind:this={box}
  transition:fly={{ x: 48, duration: motion(280), easing: cubicOut }}
>
  <header>
    <h2 id="panel-title">{title}</h2>
    <button class="ib" aria-label="Close" onclick={onclose}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
    </button>
  </header>
  <div class="body">{@render children()}</div>
</div>

<style>
  .scrim { position: fixed; inset: 60px 0 0 0; border: 0; padding: 0; background: rgba(0, 0, 0, 0.28); cursor: default; }
  .panel {
    position: fixed; top: 60px; right: 0; bottom: 0; width: min(520px, 100vw - 120px); display: flex; flex-direction: column;
    background: var(--surface); border-left: 1px solid var(--border); box-shadow: var(--shadow); outline: none;
  }
  header { display: flex; align-items: center; justify-content: space-between; padding: 14px 14px 10px 20px; border-bottom: 1px solid var(--border); }
  .body { flex: 1; overflow: auto; padding: 16px 20px 24px; display: flex; flex-direction: column; gap: 14px; user-select: text; }
</style>
