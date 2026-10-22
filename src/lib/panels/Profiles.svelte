<script lang="ts">
  import { ask, open, save as saveDialog } from '@tauri-apps/plugin-dialog';
  import { ui } from '../app.svelte';
  import { freshProfiles, importProfiles } from '../migrate/nomina';
  import { rulesFromProfile } from '../rename/engine/profile';
  import { pathKey } from '../rename/engine/files';
  import { useProfile } from '../rename/session.svelte';
  import { ipc } from '../shared/ipc';
  import { data, save } from '../shared/state.svelte';
  import type { RenameProfile, SplitProfile } from '../shared/types';
  import { useProfile as useSplit } from '../split/session.svelte';

  type Any = RenameProfile | SplitProfile;
  const MODE = { value: 'By value', people: 'People', rows: 'Rows', parts: 'Parts', sheets: 'Sheets' };
  let kind = $state<'rename' | 'split'>(ui.tool);
  const shown = $derived<Any[]>(data.profiles[kind]);
  let editing = $state<string | null>(null);
  let message = $state('');
  const clean = (e: unknown) => String(e).replace(/^[a-z]+: /, '');

  function describe(p: RenameProfile) {
    const r = rulesFromProfile(p);
    const text = r.prefix || r.suffix ? ` · ${r.prefix}value${r.suffix}` : '';
    return `${r.keyword || 'no keyword'} · ${r.position}${text}${r.destination.mode === 'copy' ? ' · copy to folder' : ''}`;
  }
  function describeSplit(p: SplitProfile) {
    const r = p.rules;
    return r.mode === 'value' ? `${MODE.value} · ${r.column || 'no column'}` : MODE[r.mode];
  }
  function use(p: Any) {
    if (kind === 'split') useSplit(p as SplitProfile);
    else useProfile(p as RenameProfile);
    ui.tool = kind;
    ui.panel = null;
  }
  /** Another split profile that archives into the same folder. */
  const sharedWith = (p: SplitProfile) =>
    p.archiveFolder ? data.profiles.split.find((x) => x.id !== p.id && x.archiveFolder && pathKey(x.archiveFolder) === pathKey(p.archiveFolder!))?.name : undefined;
  async function chooseArchive(p: SplitProfile) {
    const folder = await open({ directory: true, defaultPath: p.archiveFolder || undefined });
    if (!folder) return;
    p.archiveFolder = folder;
    save('profiles');
  }
  function rename(p: Any, name: string) {
    if (editing !== p.id) return;
    editing = null;
    if (name.trim()) {
      p.name = name.trim();
      save('profiles');
    }
  }
  function duplicate(p: Any) {
    const list: Any[] = data.profiles[kind];
    list.splice(list.indexOf(p) + 1, 0, { ...$state.snapshot(p), id: crypto.randomUUID(), name: `${p.name} (copy)` });
    save('profiles');
  }
  async function remove(p: Any) {
    if (!(await ask(`Delete the profile "${p.name}"?`, { title: 'Delete profile', kind: 'warning' }))) return;
    data.profiles[kind] = data.profiles[kind].filter((x) => x.id !== p.id) as never;
    save('profiles');
  }
  async function exportAll() {
    message = '';
    try {
      const path = await saveDialog({ defaultPath: 'vellova-profiles.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
      if (!path) return;
      await ipc.saveText(path, JSON.stringify({ rename: $state.snapshot(data.profiles.rename), split: $state.snapshot(data.profiles.split) }, null, 2));
      const n = data.profiles.rename.length + data.profiles.split.length;
      message = `Exported ${n} ${n === 1 ? 'profile' : 'profiles'}.`;
    } catch (e) {
      message = `The profiles couldn't be exported: ${clean(e)}`;
    }
  }
  async function importFile() {
    message = '';
    try {
      const path = await open({ filters: [{ name: 'JSON', extensions: ['json'] }] });
      if (!path) return;

      const got = importProfiles(new TextDecoder().decode(await ipc.readFile(path)));
      const fresh = freshProfiles(data.profiles.rename.map((p) => p.id), got.rename);
      const freshSplit = freshProfiles(data.profiles.split.map((p) => p.id), got.split);
      data.profiles.rename = [...data.profiles.rename, ...fresh];
      data.profiles.split = [...data.profiles.split, ...freshSplit];
      save('profiles');
      const n = fresh.length + freshSplit.length;
      if (freshSplit.length && !fresh.length) kind = 'split';
      message = n ? `Imported ${n} ${n === 1 ? 'profile' : 'profiles'}.` : 'No new profiles in that file.';
    } catch (e) {
      message = `That file couldn't be read: ${clean(e)}`;
    }
  }
</script>

<div class="row">
  <button class="btn small" onclick={() => void importFile()}>Import…</button>
  <button class="btn small" disabled={!data.profiles.rename.length && !data.profiles.split.length} onclick={() => void exportAll()}>Export all…</button>
</div>
{#if message}<p class="hint" role="status">{message}</p>{/if}
<div class="seg" role="group" aria-label="Profiles for">
  <button aria-pressed={kind === 'rename'} onclick={() => ((kind = 'rename'), (editing = null))}>Rename</button>
  <button aria-pressed={kind === 'split'} onclick={() => ((kind = 'split'), (editing = null))}>Split</button>
</div>
<p class="hint">To create a profile, set up {kind === 'split' ? 'Split' : 'Rename'} and choose "Save as new profile".</p>

{#each shown as p (p.id)}
  <div class="card">
    {#if editing === p.id}
      <input
        class="field"
        aria-label="Profile name"
        value={p.name}
        {@attach (el) => el.focus()}
        onkeydown={(e) => {
          if (e.key === 'Enter') rename(p, e.currentTarget.value);
          if (e.key === 'Escape') {
            e.stopPropagation();
            editing = null;
          }
        }}
        onblur={(e) => rename(p, e.currentTarget.value)}
      />
    {:else}
      <h3>{p.name}</h3>
    {/if}
    <p class="hint mono">{kind === 'split' ? describeSplit(p as SplitProfile) : describe(p as RenameProfile)}</p>
    {#if p.desc}<p class="hint">{p.desc}</p>{/if}
    {#if kind === 'split'}
      {@const sp = p as SplitProfile}
      <div class="row">
        <span class="hint">Archive folder: <span class="mono">{sp.archiveFolder || 'none'}</span></span>
        <button class="btn small" onclick={() => void chooseArchive(sp)}>Choose…</button>
        <button class="btn small" disabled={!sp.archiveFolder} onclick={() => ((sp.archiveFolder = null), save('profiles'))}>Clear</button>
      </div>
      {#if sharedWith(sp)}<p class="hint">Also used by "{sharedWith(sp)}".</p>{/if}
    {/if}
    <div class="row">
      <button class="btn small primary" onclick={() => use(p)}>Use</button>
      <button class="btn small" onclick={() => (editing = p.id)}>Rename</button>
      <button class="btn small" onclick={() => duplicate(p)}>Duplicate</button>
      <button class="btn small" onclick={() => void remove(p)}>Delete</button>
    </div>
  </div>
{:else}
  <p class="hint">No profiles yet.</p>
{/each}
