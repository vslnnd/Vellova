<script lang="ts">
  import { tick } from 'svelte';
  import { data } from '../shared/state.svelte';
  import ProfileBar from '../shared/ProfileBar.svelte';
  import type { Step } from '../shared/types';
  import { island } from '../shell/islandState.svelte';
  import { NEW_STEP } from './engine/steps';
  import { stepView } from './RenameSettings.svelte';
  import { pickCopyFolder, reset, saveProfile, session, useProfile } from './session.svelte';

  const DEST = { inplace: 'Rename in place', copy: 'Copy to…', move: 'Move to…' } as const;
  const SOURCES: Step['type'][] = ['pdfValue', 'pdfPattern', 'list'];
  const TOKENS = ['{value}', '{n}', '{date}'];

  const rules = $derived(session.rules);
  const dest = $derived(rules.destination);

  function pick(id: string | null) {
    const p = data.profiles.rename.find((x) => x.id === id);
    if (p) useProfile(p);
    else session.profileId = null;
  }

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
    if (kind !== 'list') return;
    session.editing = true;
    await tick();
    document.querySelector<HTMLElement>('[data-part="choose-list"]')?.focus();
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
  <ProfileBar id="rn-profile" tour="profile" profiles={data.profiles.rename} current={session.profileId} onpick={pick} onsave={saveProfile} />
  <span class="vr"></span>
  <div class="grp">
    <span class="label" id="rn-from">Name from</span>
    <div class="seg" role="group" aria-labelledby="rn-from">
      <button aria-pressed={rules.steps[0]?.type !== 'list'} onclick={() => void nameFrom('pdf')}>Text in the PDF</button>
      <button disabled>Click on the PDF</button>
      <button aria-pressed={rules.steps[0]?.type === 'list'} onclick={() => void nameFrom('list')}>A list</button>
    </div>
  </div>
  <span class="vr"></span>
  <div class="grp">
    <span class="label" id="rn-dest-l">Files go</span>
    <button class="dd" data-part="dest" aria-labelledby="rn-dest-l rn-dest-b" id="rn-dest-b" popovertarget="rn-dest" style="anchor-name: --rn-dest">{DEST[dest.mode]}</button>
    <div class="pop" id="rn-dest" popover style="position-anchor: --rn-dest">
      <div class="seg" role="group" aria-label="Files go">
        {#each Object.entries(DEST) as [m, label] (m)}
          <button aria-pressed={dest.mode === m} onclick={() => setMode(m as keyof typeof DEST)}>{label}</button>
        {/each}
      </div>
      {#if dest.mode !== 'inplace'}
        <label class="label" for="rn-folder">Folder</label>
        <div class="row nowrap">
          <input id="rn-folder" class="field mono" spellcheck="false" bind:value={dest.folder} />
          <button class="btn small" onclick={() => void pickCopyFolder()}>Choose…</button>
        </div>
        <div class="row">
          {#each TOKENS as t (t)}<button class="chip mono" onclick={() => addToken(t)}>{t}</button>{/each}
        </div>
      {/if}
    </div>
  </div>
  <span class="vr"></span>
  <div class="grp">
    <label class="label" for="rn-conflict">If taken</label>
    <select id="rn-conflict" class="dd" data-part="conflict" bind:value={session.rules.conflict}>
      <option value="add">Add (1)</option>
      <option value="skip">Skip</option>
      <option value="replace">Replace (Recycle Bin)</option>
    </select>
  </div>
  <span class="vr"></span>
  <div class="grp">
    <label class="label" for="rn-pair">Matching files</label>
    <select id="rn-pair" class="dd" data-part="pair" value={rules.pair ? 'yes' : 'no'} onchange={(e) => (session.rules.pair = e.currentTarget.value === 'yes')}>
      <option value="yes">Rename too</option>
      <option value="no">Leave alone</option>
    </select>
  </div>
  <span class="grow"></span>
  <button class="btn small" disabled={session.busy || !!island.activity} onclick={reset}>Reset</button>
</div>

<style>
  .pop { width: 380px; }
  .nowrap { flex-wrap: nowrap; }
</style>
