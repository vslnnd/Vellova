<script lang="ts">
  import { data, save } from '../shared/state.svelte';
  import { pickFiles, pickFolder } from './session.svelte';
</script>

<div class="drop">
  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V4M7 9l5-5 5 5" /><path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" /></svg>
  <p class="big">Drop files or folders here</p>
  <p class="hint">PDFs, plus the .xlsx, .csv, .xml and .txt files that belong to them</p>
  <div class="row">
    <button class="btn primary" onclick={() => void pickFiles()}>Add files</button>
    <button class="btn" onclick={() => void pickFolder()}>Add folder</button>
  </div>
  <label class="inline"><input type="checkbox" bind:checked={data.settings.rename.recursive} onchange={() => save('settings')} /> Include subfolders</label>
</div>

<style>
  .drop {
    flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px;
    border: 1.5px dashed var(--border2); border-radius: 8px; background: var(--surface); padding: 32px;
  }
  .big { margin: 4px 0 0; font-size: 16px; font-weight: 600; }
  .hint { text-align: center; }
</style>
