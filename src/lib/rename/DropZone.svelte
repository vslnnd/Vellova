<script lang="ts">
  import type { Snippet } from 'svelte';
  import { pickFiles, pickFolder } from './session.svelte';

  /** The whole screen while a tool has no files. Rename's by default; Split passes its own title and pickers. */
  let { title = 'Drop files or folders here', onfiles = pickFiles, onfolder = pickFolder, tour, children }: {
    title?: string;
    onfiles?: () => Promise<void>;
    onfolder?: () => Promise<void>;
    tour?: string;
    /** shown under the buttons: the profile picker */
    children?: Snippet;
  } = $props();
</script>

<div class="drop" data-tour={tour}>
  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V4M7 9l5-5 5 5" /><path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" /></svg>
  <p class="big">{title}</p>
  <div class="row">
    <button class="btn primary" onclick={() => void onfiles()}>Add files</button>
    <button class="btn" onclick={() => void onfolder()}>Add folder</button>
  </div>
  {#if children}<div class="extra">{@render children()}</div>{/if}
</div>

<style>
  .drop {
    flex: 1; min-height: 0; margin-bottom: 20px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px;
    border: 1.5px dashed var(--border2); border-radius: 10px; background: var(--surface); padding: 24px;
  }
  .big { margin: 4px 0 0; font-size: 18px; font-weight: 600; text-align: center; }
  .extra { margin-top: 14px; }
</style>
