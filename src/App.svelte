<script lang="ts">
  import { listen } from '@tauri-apps/api/event';
  import { onMount } from 'svelte';
  import { PANEL_TITLES, ui } from './lib/app.svelte';
  import { undoLast } from './lib/shared/batches';
  import History from './lib/panels/History.svelte';
  import NeedsAttention from './lib/panels/NeedsAttention.svelte';
  import Profiles from './lib/panels/Profiles.svelte';
  import Settings from './lib/panels/Settings.svelte';
  import { ipc } from './lib/shared/ipc';
  import { data, log } from './lib/shared/state.svelte';
  import Rename from './lib/rename/Rename.svelte';
  import { addPaths as addRename, cancelActivity as cancelRename, session as renameSession } from './lib/rename/session.svelte';
  import { cancelTarget } from './lib/shell/cancel';
  import Panel from './lib/shell/Panel.svelte';
  import { shortcut } from './lib/shell/shortcuts';
  import TitleBar from './lib/shell/TitleBar.svelte';
  import Split from './lib/split/Split.svelte';
  import { addPaths as addSplit, cancelActivity as cancelSplit, session as splitSession } from './lib/split/session.svelte';
  import Tour from './lib/tour/TourLayer.svelte'; // not Tour.svelte: on Windows it would shadow the tour.svelte(.ts) module
  import { current, dismissResume, tour, tourActive, undoTour } from './lib/tour/tour.svelte';
  import { restartToUpdate, scheduleUpdates } from './lib/updater';

  if (!data.settings.welcomed) tour.card = 'welcome';
  if (import.meta.env.PROD) scheduleUpdates(true);

  const closePanel = () => (ui.panel = null);
  /** The island's Cancel goes to the session that owns its activity, whichever tool is on screen. */
  const cancel = () => (cancelTarget(splitSession, renameSession, ui.tool) === 'split' ? cancelSplit() : cancelRename());

  const inText = () => !!document.activeElement?.matches('input:not([type=checkbox]):not([type=radio]), textarea, select');

  function onkeydown(e: KeyboardEvent) {
    const action = shortcut(e, inText());
    if (tourActive() && !(action === 'undo' && current()?.id === 'undo')) return; // during the tour only the step's own shortcut works
    if (!action || (action === 'close-panel' && !ui.panel)) return;
    e.preventDefault();
    if (action === 'close-panel') closePanel();
    else if (action === 'tool-rename') ui.tool = 'rename';
    else if (action === 'tool-split') ui.tool = 'split';
    else undo();
  }

  /** Takes what Explorer's right-click menu queued; the `launch` event only says there is more. */
  async function takeLaunches() {
    try {
      const launches = await ipc.takeLaunches();
      if (!launches.length) return;
      dismissResume(); // the files win over "Resume the tour?", which would clear them
      if (tourActive()) {
        log({ level: 'info', tool: 'app', message: 'Files sent from Explorer during the tour were not added.' });
        return;
      }
      for (const l of launches) {
        ui.tool = l.tool;
        ui.panel = null;
        await (l.tool === 'split' ? addSplit : addRename)(l.paths);
      }
      dismissResume(); // the card may have appeared while the files were being added
    } catch (e) {
      log({ level: 'error', tool: 'app', message: 'Files sent from Explorer could not be added.', detail: String(e) });
    }
  }

  // listen first, so a launch that arrives while the queue is being taken is not missed
  onMount(() => {
    const off = listen('launch', () => void takeLaunches());
    void off.then(takeLaunches);
    return () => void off.then((f) => f());
  });

  /** During the tour, Undo (Ctrl+Z or the island) touches only the tour's batch. */
  const undo = () => void (tourActive() ? undoTour() : undoLast());
</script>

<svelte:window {onkeydown} />

<div class="app">
  <TitleBar oncancel={cancel} onundo={undo} onrestart={() => void restartToUpdate()} />
  <main inert={!!ui.panel}>
    <div class="screen" class:on={ui.tool === 'rename'} inert={ui.tool !== 'rename'}>
      <Rename />
    </div>
    <div class="screen" class:on={ui.tool === 'split'} inert={ui.tool !== 'split'}>
      <Split />
    </div>
  </main>
  {#if ui.panel}
    <Panel title={PANEL_TITLES[ui.panel]} onclose={closePanel}>
      {#if ui.panel === 'history'}<History />
      {:else if ui.panel === 'profiles'}<Profiles />
      {:else if ui.panel === 'settings'}<Settings />
      {:else}<NeedsAttention />{/if}
    </Panel>
  {/if}
  <Tour />
</div>

<style>
  .app { height: 100%; display: flex; flex-direction: column; }
  main { position: relative; flex: 1; min-height: 0; }
  .screen {
    position: absolute; inset: 0; padding: 20px 24px 0; display: flex; flex-direction: column; opacity: 0; transform: translateY(8px); visibility: hidden;
    transition: opacity 260ms ease, transform 360ms cubic-bezier(0.2, 0.8, 0.2, 1), visibility 0s linear 260ms;
  }
  .screen.on { opacity: 1; transform: none; visibility: visible; transition-delay: 0s; }
</style>
