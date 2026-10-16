<script lang="ts">
  import { findOldData, importOldData } from '../migrate/run';

  let { onclose }: { onclose: () => void } = $props();
  let found = $state(false);
  let busy = $state(false);
  let result = $state('');

  $effect(() => {
    findOldData().then((f) => (found = f), () => (found = false));
  });

  async function bring() {
    busy = true;
    result = await importOldData(true).catch((e) => `The import failed: ${e}`);
    busy = false;
  }
</script>

<p>Vellova renames PDFs using a value found inside them, and renames their matching spreadsheets and text files with them. Splitting spreadsheets comes in the next update.</p>
<p class="hint">Everything stays on this computer. Every batch can be undone from History.</p>

{#if found}
  <div class="card">
    <h3>Bring your earlier setup</h3>
    <p class="hint">Profiles, history and settings from your previous renaming app are on this computer. The old app keeps its own copy.</p>
    {#if result}
      <p role="status">{result}</p>
    {:else}
      <div class="row">
        <button class="btn primary" disabled={busy} onclick={bring}>Import</button>
        <button class="btn" onclick={onclose}>Not now</button>
      </div>
    {/if}
  </div>
{/if}

<div class="row"><button class="btn primary" onclick={onclose}>Get started</button></div>
