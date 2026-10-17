<script lang="ts">
  import { tick } from 'svelte';
  import { findOldData, importOldData } from '../migrate/run';

  let { onstart, onskip }: { onstart: () => void; onskip: () => void } = $props();
  let found = $state(false);
  let later = $state(false);
  let busy = $state(false);
  let result = $state('');
  let start = $state<HTMLButtonElement>();

  $effect(() => {
    findOldData().then((f) => (found = f), () => (found = false));
  });

  async function bring() {
    busy = true;
    result = await importOldData(true).catch((e) => `The import failed: ${String(e).replace(/^[a-z]+: /, '')}`);
    busy = false;
    await tick();
    start?.focus(); // the Import button is gone: keep focus inside the card
  }
</script>

<h2 id="tour-title">Welcome to Vellova</h2>
<p>
  Vellova renames files in batches, for example using an invoice number printed in a PDF, with matching spreadsheets renamed along
  with it. Renaming any file type by your own rules is coming in the next updates, along with splitting spreadsheets.
</p>
<p class="hint">Everything stays on this computer. Every batch can be undone from History.</p>

{#if found && !later}
  <div class="card">
    <h3>Bring your earlier setup</h3>
    <p class="hint">Profiles, history and settings from your previous renaming app are on this computer. The old app keeps its own copy.</p>
    {#if result}
      <p role="status">{result}</p>
    {:else}
      <div class="row">
        <button class="btn" disabled={busy} onclick={bring}>Import</button>
        <button class="btn" onclick={() => (later = true)}>Not now</button>
      </div>
    {/if}
  </div>
{/if}

<div class="row">
  <button class="btn primary" data-first bind:this={start} onclick={onstart}>Try it with sample files</button>
  <button class="btn" onclick={onskip}>Skip</button>
</div>
