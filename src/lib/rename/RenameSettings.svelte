<script lang="ts">
  import { data } from '../shared/state.svelte';
  import type { Conflict, Position } from '../shared/types';
  import { pickCopyFolder, saveProfile, session, useProfile } from './session.svelte';

  const POSITIONS: [Position, string][] = [['after', 'After'], ['before', 'Before'], ['below', 'Below'], ['above', 'Above']];
  const CONFLICTS: [Conflict, string][] = [['add', 'Add (1)'], ['skip', 'Skip'], ['replace', 'Replace']];
  const rules = $derived(session.rules);
  // until the step editor: the first step when it is a value step, and the first add text step
  const value = $derived(rules.steps[0]?.type === 'pdfValue' ? rules.steps[0] : null);
  const text = $derived(rules.steps.find((s) => s.type === 'addText'));
  function setText(k: 'prefix' | 'suffix', v: string) {
    if (text) text[k] = v;
    else session.rules.steps.push({ type: 'addText', prefix: '', suffix: '', [k]: v });
  }
  const current = $derived(data.profiles.rename.find((p) => p.id === session.profileId));
  let naming = $state(false);
  let newName = $state('');

  function pick(id: string) {
    const p = data.profiles.rename.find((x) => x.id === id);
    if (p) useProfile(p);
    else session.profileId = null;
  }
  function saveNew() {
    if (!newName.trim()) return;
    saveProfile(newName.trim());
    naming = false;
    newName = '';
  }
  function setCopy(copy: boolean) {
    session.rules.destination = copy ? { mode: 'copy', folder: data.settings.rename.folder } : { mode: 'inplace' };
  }
</script>

<div class="settings">
  <div class="card" data-tour="profile">
    <label class="label" for="rn-profile">Profile</label>
    <select id="rn-profile" class="field" value={session.profileId ?? ''} onchange={(e) => pick(e.currentTarget.value)}>
      <option value="">No profile</option>
      {#each data.profiles.rename as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
    </select>
    <div class="row">
      {#if current}<button class="btn small" onclick={() => saveProfile()}>Save changes</button>{/if}
      {#if naming}
        <input class="field grow" aria-label="New profile name" placeholder="Profile name" bind:value={newName} onkeydown={(e) => e.key === 'Enter' && saveNew()} />
        <button class="btn small primary" disabled={!newName.trim()} onclick={saveNew}>Save</button>
      {:else}
        <button class="btn small" onclick={() => (naming = true)}>Save as new profile</button>
      {/if}
    </div>
  </div>

  {#if value}
    <div class="card">
      <h3>Value from PDF</h3>
      <label class="label" for="rn-kw">Keyword</label>
      <input id="rn-kw" data-tour="keyword" class="field mono" placeholder="Invoice No.:" spellcheck="false" bind:value={value.keyword} />
      <span class="label" id="rn-pos">The value is … the keyword</span>
      <div class="seg" role="group" aria-labelledby="rn-pos" data-tour="position">
        {#each POSITIONS as [v, label] (v)}
          <button aria-pressed={value.position === v} onclick={() => (value.position = v)}>{label}</button>
        {/each}
      </div>
      <label class="inline">Use match number <input class="field num" type="number" min="1" max="99" bind:value={value.occurrence} /></label>
    </div>
  {/if}

  <div class="card">
    <h3>Add text</h3>
    <div class="two">
      <label class="label">Before the value <input class="field mono" spellcheck="false" placeholder="CN_" value={text?.prefix ?? ''} oninput={(e) => setText('prefix', e.currentTarget.value)} /></label>
      <label class="label">After the value <input class="field mono" spellcheck="false" placeholder="_final" value={text?.suffix ?? ''} oninput={(e) => setText('suffix', e.currentTarget.value)} /></label>
    </div>
    <p class="hint mono">{text?.prefix}<span class="v">value</span>{text?.suffix}.pdf</p>
  </div>

  <div class="card">
    <label class="inline"><input type="checkbox" bind:checked={session.rules.pair} /> Rename matching .xlsx, .csv, .xml and .txt files with their PDF</label>
  </div>

  <div class="card">
    <h3>Output</h3>
    <div class="seg" role="group" aria-label="Where the files go">
      <button aria-pressed={rules.destination.mode === 'inplace'} onclick={() => setCopy(false)}>Rename in place</button>
      <button aria-pressed={rules.destination.mode === 'copy'} onclick={() => setCopy(true)}>Copy to folder</button>
    </div>
    {#if rules.destination.mode === 'copy'}
      <div class="row">
        <span class="folder mono" title={rules.destination.folder}>{rules.destination.folder || 'No folder chosen'}</span>
        <button class="btn small" onclick={() => void pickCopyFolder()}>Choose…</button>
      </div>
    {/if}
    <span class="label" id="rn-conf">If the name is taken</span>
    <div class="seg" role="group" aria-labelledby="rn-conf">
      {#each CONFLICTS as [v, label] (v)}
        <button aria-pressed={rules.conflict === v} onclick={() => (session.rules.conflict = v)}>{label}</button>
      {/each}
    </div>
    {#if rules.conflict === 'replace'}<p class="hint">Replaced files go to the Recycle Bin.</p>{/if}
  </div>
</div>

<style>
  .settings { flex: 0 0 300px; overflow: auto; display: flex; flex-direction: column; gap: 12px; padding: 0 2px 12px; }
  .two { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .two .label { display: flex; flex-direction: column; gap: 4px; }
  .num { width: 64px; }
  .v { color: var(--accent); }
  .grow { flex: 1; min-width: 0; }
  .folder { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: var(--text2); }
</style>
