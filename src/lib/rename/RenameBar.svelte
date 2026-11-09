<script lang="ts">
  import { tick } from 'svelte';
  import { data } from '../shared/state.svelte';
  import ProfileBar from '../shared/ProfileBar.svelte';
  import type { Conflict, Step } from '../shared/types';
  import { island } from '../shell/islandState.svelte';
  import { NEW_STEP } from './engine/steps';
  import { stepView } from './RenameSettings.svelte';
  import { pickCopyFolder, pickProfile, reset, saveProfile, session } from './session.svelte';

  const DEST = { inplace: 'Rename in place', copy: 'Copy to', move: 'Move to' } as const;
  const CONFLICTS: [Conflict, string, string?][] = [['add', 'Add (1)'], ['skip', 'Skip'], ['replace', 'Replace', 'The file that is there goes to the Recycle Bin']];
  const SOURCES: Step['type'][] = ['pdfValue', 'pdfPattern', 'list'];
  const TOKENS = [['{value}', 'Value'], ['{n}', 'Number'], ['{date}', 'Date']];

  const rules = $derived(session.rules);
  const dest = $derived(rules.destination);
  const list = $derived(rules.steps[0]?.type === 'list');
  /** something under Options is not the default */
  const custom = $derived(dest.mode !== 'inplace' || rules.conflict !== 'add' || !rules.pair);

  /** Step 1 becomes a PDF value or a list step; a source step of the other kind is replaced, a modifier stays after it. */
  async function nameFrom(kind: 'pdf' | 'list') {
    const steps = session.rules.steps;
    const t = steps[0]?.type;
    const keep = kind === 'list' ? t === 'list' : t === 'pdfValue' || t === 'pdfPattern';
    if (!keep) {
      const step = structuredClone(NEW_STEP[kind === 'list' ? 'list' : 'pdfValue']);
      if (t && SOURCES.includes(t)) steps[0] = step;
      else steps.unshift(step);
    }
    stepView.open = 0;
    session.editing = true;
    await tick();
    document.querySelector<HTMLElement>(kind === 'list' ? '[data-part="choose-list"]' : '[data-tour="keyword"]')?.focus();
  }

  function setMode(mode: keyof typeof DEST) {
    const folder = (dest.mode !== 'inplace' && dest.folder) || data.settings.rename.folder;
    session.rules.destination = mode === 'inplace' ? { mode } : { mode, folder };
  }

  function addToken(t: string) {
    if (session.rules.destination.mode === 'inplace') return;
    const f = session.rules.destination.folder;
    session.rules.destination.folder = f ? f.replace(/[\\/]*$/, '\\') + t : t;
  }
</script>

<div class="card bar">
  <ProfileBar id="rn-profile" tour="profile" profiles={data.profiles.rename} current={session.profileId} onpick={pickProfile} onsave={saveProfile} />
  <span class="vr"></span>
  <div class="grp">
    <span class="label" id="rn-from">Name from</span>
    <div class="seg" role="group" aria-labelledby="rn-from">
      <button aria-pressed={!list} onclick={() => void nameFrom('pdf')}>PDF text</button>
      <button aria-pressed={list} onclick={() => void nameFrom('list')}>A list</button>
    </div>
  </div>
  <span class="grow"></span>
  <button class="btn" data-part="options" popovertarget="rn-opts" style="anchor-name: --rn-opts">
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M7 12h10M10 17h4" /></svg>
    Options
    {#if custom}<span class="dot"></span><span class="sr">changed</span>{/if}
  </button>
  <div class="pop opts" id="rn-opts" popover style="position-anchor: --rn-opts">
    <div class="line">
      <span class="label" id="rn-dest-l">Files go</span>
      <div class="seg" role="group" aria-labelledby="rn-dest-l">
        {#each Object.entries(DEST) as [m, label] (m)}
          <button data-part={dest.mode === m ? 'dest' : undefined} aria-pressed={dest.mode === m} onclick={() => setMode(m as keyof typeof DEST)}>{label}</button>
        {/each}
      </div>
      {#if dest.mode !== 'inplace'}
        <div class="row nowrap wide">
          <input class="field mono" aria-label="Folder" placeholder="Folder" spellcheck="false" bind:value={dest.folder} />
          <button class="btn small" onclick={() => void pickCopyFolder()}>Choose…</button>
        </div>
        <div class="row wide">
          <span class="label">Sort into folders by</span>
          {#each TOKENS as [t, label] (t)}<button class="chip" title={t} onclick={() => addToken(t)}>{label}</button>{/each}
        </div>
      {/if}
    </div>
    <div class="line">
      <span class="label" id="rn-taken-l">If taken</span>
      <div class="seg" role="group" aria-labelledby="rn-taken-l">
        {#each CONFLICTS as [v, label, tip] (v)}
          <button data-part={rules.conflict === v ? 'conflict' : undefined} aria-pressed={rules.conflict === v} title={tip} onclick={() => (session.rules.conflict = v)}>{label}</button>
        {/each}
      </div>
    </div>
    <div class="line">
      <span class="label" id="rn-pair-l">Matching files</span>
      <div class="seg" role="group" aria-labelledby="rn-pair-l">
        <button data-part={rules.pair ? 'pair' : undefined} aria-pressed={rules.pair} onclick={() => (session.rules.pair = true)}>Rename too</button>
        <button data-part={rules.pair ? undefined : 'pair'} aria-pressed={!rules.pair} onclick={() => (session.rules.pair = false)}>Leave alone</button>
      </div>
    </div>
    <div class="line">
      <span></span>
      <button class="btn small" disabled={session.busy || !!island.activity} onclick={reset}>Reset</button>
    </div>
  </div>
</div>

<style>
  .nowrap { flex-wrap: nowrap; }
</style>
