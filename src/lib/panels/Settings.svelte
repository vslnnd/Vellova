<script lang="ts">
  import { getVersion } from '@tauri-apps/api/app';
  import { openUrl } from '@tauri-apps/plugin-opener';
  import { flushSync } from 'svelte';
  import { setTheme } from '../app.svelte';
  import { findOldData, importOldData } from '../migrate/run';
  import { session } from '../rename/session.svelte';
  import { data, save } from '../shared/state.svelte';
  import { switchTheme, type ThemePref } from '../shell/theme';
  import { startTour } from '../tour/tour.svelte';
  import { checkForUpdate, scheduleUpdates } from '../updater';

  const THEMES: [ThemePref, string][] = [['light', 'Light'], ['dark', 'Dark'], ['system', 'System']];
  /** One choice for both update settings: a timed check also checks at start. */
  const UPDATES: [string, string][] = [['1', 'Every hour'], ['6', 'Every 6 hours'], ['24', 'Once a day'], ['start', 'When Vellova starts'], ['never', 'Never']];
  let version = $state('');
  let old = $state(false);
  let busy = $state(false);
  let imported = $state('');
  let checking = $state(false);
  let updateText = $state('');

  const updates = $derived.by(() => {
    const u = data.settings.updates;
    return u.everyHours > 0 ? String(u.everyHours) : u.onStartup ? 'start' : 'never';
  });

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
  function setUpdates(v: string) {
    data.settings.updates = v === 'never' ? { onStartup: false, everyHours: 0 } : { onStartup: true, everyHours: v === 'start' ? 0 : Number(v) };
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
  function clearFolder() {
    data.settings.rename.folder = '';
    save('settings');
  }
</script>

<div class="rows">
  <div class="item">
    <span id="st-theme">Theme</span>
    <div class="seg" role="group" aria-labelledby="st-theme">
      {#each THEMES as [v, label] (v)}
        <button aria-pressed={data.settings.theme === v} onclick={(e) => theme(v, e.currentTarget)}>{label}</button>
      {/each}
    </div>
  </div>
  <label class="item">
    <span>Check for updates</span>
    <select class="field auto" value={updates} onchange={(e) => setUpdates(e.currentTarget.value)}>
      {#each UPDATES as [v, label] (v)}<option value={v}>{label}</option>{/each}
    </select>
  </label>
  <div class="item">
    <span>Vellova {version}{#if updateText}<span class="status" role="status">{updateText}</span>{/if}</span>
    <button class="btn small" disabled={checking} onclick={() => void checkNow()}>{checking ? 'Checking…' : 'Check now'}</button>
  </div>
</div>

<div class="rows">
  <label class="item">
    <span>Open the folder when a batch is done</span>
    <input class="switch" type="checkbox" bind:checked={data.settings.openWhenDone} onchange={() => save('settings')} />
  </label>
  <label class="item">
    <span>Include subfolders when adding a folder to Rename</span>
    <input class="switch" type="checkbox" bind:checked={data.settings.rename.recursive} onchange={() => save('settings')} />
  </label>
  <label class="item">
    <span>Archive originals after splitting</span>
    <input class="switch" type="checkbox" bind:checked={data.settings.split.archive} onchange={() => save('settings')} />
  </label>
  {#if data.settings.rename.folder}
    <div class="item">
      <span>Copy-to folder<span class="status mono">{data.settings.rename.folder}</span></span>
      <button class="btn small" onclick={clearFolder}>Clear</button>
    </div>
  {/if}
</div>

<div class="rows">
  {#if old}
    <div class="item">
      <span>Profiles and history from earlier apps{#if imported}<span class="status" role="status">{imported}</span>{/if}</span>
      <button class="btn small" disabled={busy} onclick={() => void bring()}>Import</button>
    </div>
  {/if}
  <div class="item">
    <span>Tour</span>
    <button class="btn small" disabled={session.busy} onclick={startTour}>Show the tour again</button>
  </div>
  <div class="item">
    <span>Feedback</span>
    <button class="btn small" onclick={() => void openUrl('https://github.com/vslnnd/Vellova/issues/new')}>Send feedback</button>
  </div>
</div>

<style>
  .item { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 54px; padding: 10px 16px; }
  .item > span:first-child { min-width: 0; }
  .status { margin-left: 12px; font-size: 12.5px; color: var(--text2); overflow-wrap: anywhere; }
  .auto { width: auto; }
</style>
