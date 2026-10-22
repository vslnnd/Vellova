<script lang="ts">
  import { data, save } from '../shared/state.svelte';
  import { pickFiles, pickFolder } from './session.svelte';

  /** Rename's drop zone by default; Split passes its own text and pickers (and no subfolder option). */
  let {
    title = 'Drop files or folders here',
    accept = 'PDFs, plus the .xlsx, .csv, .xml and .txt files that belong to them',
    onfiles = pickFiles,
    onfolder = pickFolder,
    recursive = true,
  }: { title?: string; accept?: string; onfiles?: () => Promise<void>; onfolder?: () => Promise<void>; recursive?: boolean } = $props();
</script>

<!-- the tour points at Rename's drop zone only -->
<div class="drop" data-tour={recursive ? 'drop' : undefined}>
  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V4M7 9l5-5 5 5" /><path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" /></svg>
  <p class="big">{title}</p>
  {#if accept}<p class="hint">{accept}</p>{/if}
  <div class="row">
    <button class="btn primary" onclick={() => void onfiles()}>Add files</button>
    <button class="btn" onclick={() => void onfolder()}>Add folder</button>
  </div>
  {#if recursive}
    <label class="inline"><input type="checkbox" bind:checked={data.settings.rename.recursive} onchange={() => save('settings')} /> Include subfolders</label>
  {/if}
</div>

<style>
  .drop {
    flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px;
    border: 1.5px dashed var(--border2); border-radius: 8px; background: var(--surface); padding: 32px;
  }
  .big { margin: 4px 0 0; font-size: 16px; font-weight: 600; }
  .hint { text-align: center; }
</style>
