<script lang="ts">
  import { PANEL_TITLES, ui } from './lib/app.svelte';
  import { undoLast } from './lib/shared/batches';
  import History from './lib/panels/History.svelte';
  import NeedsAttention from './lib/panels/NeedsAttention.svelte';
  import Profiles from './lib/panels/Profiles.svelte';
  import Settings from './lib/panels/Settings.svelte';
  import { data } from './lib/shared/state.svelte';
  import Rename from './lib/rename/Rename.svelte';
  import { cancelActivity } from './lib/rename/session.svelte';
  import Panel from './lib/shell/Panel.svelte';
  import { shortcut } from './lib/shell/shortcuts';
  import TitleBar from './lib/shell/TitleBar.svelte';
  import Split from './lib/split/Split.svelte';
  import Tour from './lib/tour/TourLayer.svelte'; // not Tour.svelte: on Windows it would shadow the tour.svelte(.ts) module
  import { current, tour, tourActive } from './lib/tour/tour.svelte';
  import { restartToUpdate, scheduleUpdates } from './lib/updater';

  if (!data.settings.welcomed) tour.card = 'welcome';
  if (import.meta.env.PROD) scheduleUpdates(true);

  const closePanel = () => (ui.panel = null);

  const inText = () => !!document.activeElement?.matches('input:not([type=checkbox]):not([type=radio]), textarea, select');

  function onkeydown(e: KeyboardEvent) {
    const action = shortcut(e, inText());
    if (tourActive() && !(action === 'undo' && current()?.id === 'undo')) return; // during the tour only the step's own shortcut works
    if (!action || (action === 'close-panel' && !ui.panel)) return;
    e.preventDefault();
    if (action === 'close-panel') closePanel();
    else if (action === 'tool-rename') ui.tool = 'rename';
    else if (action === 'tool-split') ui.tool = 'split';
    else void undoLast();
  }
</script>

<svelte:window {onkeydown} />

<div class="app">
  <TitleBar oncancel={cancelActivity} onundo={() => void undoLast()} onrestart={() => void restartToUpdate()} />
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
