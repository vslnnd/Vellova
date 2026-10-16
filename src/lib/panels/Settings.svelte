<script lang="ts">
  import { getVersion } from '@tauri-apps/api/app';
  import { openUrl } from '@tauri-apps/plugin-opener';
  import { flushSync } from 'svelte';
  import { setTheme } from '../app.svelte';
  import { findOldData, importOldData } from '../migrate/run';
  import { data, save } from '../shared/state.svelte';
  import { switchTheme, type ThemePref } from '../shell/theme';
  import { checkForUpdate, scheduleUpdates } from '../updater';

  const THEMES: [ThemePref, string][] = [['system', 'System'], ['dark', 'Dark'], ['light', 'Light']];
  const EVERY: [number, string][] = [[1, 'every hour'], [6, 'every 6 hours'], [24, 'once a day'], [0, 'never']];
  let version = $state('');
  let old = $state(false);
  let busy = $state(false);
  let imported = $state('');
  let checking = $state(false);
  let updateText = $state('');

  $effect(() => {
    getVersion().then((v) => (version = v), () => {});
    findOldData().then((f) => (old = f), () => {});
  });

  function theme(t: ThemePref, el: HTMLElement) {
    data.settings.theme = t;
    save('settings');
    switchTheme(() => {
      setTheme(t);
      flushSync();
    }, el);
  }
  function updatesChanged() {
    save('settings');
    scheduleUpdates(false);
  }
  async function checkNow() {
    checking = true;
    updateText = await checkForUpdate(true);
    checking = false;
  }
  async function bring() {
    busy = true;
    imported = await importOldData(false).catch((e) => `The import failed: ${String(e).replace(/^[a-z]+: /, "")}`);
    busy = false;
  }
</script>

<section class="card">
  <h3>Appearance</h3>
  <div class="seg" role="group" aria-label="Theme">
    {#each THEMES as [v, label] (v)}
      <button aria-pressed={data.settings.theme === v} onclick={(e) => theme(v, e.currentTarget)}>{label}</button>
    {/each}
  </div>
</section>

<section class="card">
  <h3>Updates</h3>
  <label class="inline"><input type="checkbox" bind:checked={data.settings.updates.onStartup} onchange={updatesChanged} /> Check when Vellova starts</label>
  <label class="inline">
    Check
    <select class="field auto" bind:value={data.settings.updates.everyHours} onchange={updatesChanged}>
      {#each EVERY as [v, label] (v)}<option value={v}>{label}</option>{/each}
    </select>
  </label>
  <div class="row">
    <button class="btn small" disabled={checking} onclick={() => void checkNow()}>{checking ? 'Checking…' : 'Check now'}</button>
    {#if updateText}<span class="hint" role="status">{updateText}</span>{/if}
  </div>
</section>

<section class="card">
  <h3>Rename</h3>
  <label class="inline"><input type="checkbox" bind:checked={data.settings.rename.recursive} onchange={() => save('settings')} /> Include subfolders when adding a folder</label>
  <p class="hint">Copy-to folder: <span class="mono">{data.settings.rename.folder || 'none yet'}</span></p>
</section>

{#if old}
  <section class="card">
    <h3>Earlier data</h3>
    <p class="hint">Import profiles and history from your previous renaming app. Anything imported before is skipped.</p>
    <div class="row"><button class="btn small" disabled={busy} onclick={() => void bring()}>Import</button></div>
    {#if imported}<p class="hint" role="status">{imported}</p>{/if}
  </section>
{/if}

<section class="card">
  <h3>About</h3>
  <p class="hint">Vellova {version}. Your files, history and log never leave this computer.</p>
  <div class="row">
    <button class="btn small" onclick={() => void openUrl('https://github.com/vslnnd/Vellova/issues/new')}>Send feedback</button>
  </div>
</section>

<style>
  .auto { width: auto; }
</style>
