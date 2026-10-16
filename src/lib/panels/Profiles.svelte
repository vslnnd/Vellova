<script lang="ts">
  import { ask, open, save as saveDialog } from '@tauri-apps/plugin-dialog';
  import { ui } from '../app.svelte';
  import { freshProfiles, importProfiles } from '../migrate/nomina';
  import { rulesFromProfile } from '../rename/engine/profile';
  import { useProfile } from '../rename/session.svelte';
  import { ipc } from '../shared/ipc';
  import { data, save } from '../shared/state.svelte';
  import type { RenameProfile } from '../shared/types';

  let editing = $state<string | null>(null);
  let message = $state('');
  const clean = (e: unknown) => String(e).replace(/^[a-z]+: /, '');

  function describe(p: RenameProfile) {
    const r = rulesFromProfile(p);
    const text = r.prefix || r.suffix ? ` · ${r.prefix}value${r.suffix}` : '';
    return `${r.keyword || 'no keyword'} · ${r.position}${text}${r.destination.mode === 'copy' ? ' · copy to folder' : ''}`;
  }
  function use(p: RenameProfile) {
    useProfile(p);
    ui.tool = 'rename';
    ui.panel = null;
  }
  function rename(p: RenameProfile, name: string) {
    if (editing !== p.id) return;
    editing = null;
    if (name.trim()) {
      p.name = name.trim();
      save('profiles');
    }
  }
  function duplicate(p: RenameProfile) {
    const list = data.profiles.rename;
    list.splice(list.indexOf(p) + 1, 0, { ...$state.snapshot(p), id: crypto.randomUUID(), name: `${p.name} (copy)` });
    save('profiles');
  }
  async function remove(p: RenameProfile) {
    if (!(await ask(`Delete the profile "${p.name}"?`, { title: 'Delete profile', kind: 'warning' }))) return;
    data.profiles.rename = data.profiles.rename.filter((x) => x.id !== p.id);
    save('profiles');
  }
  async function exportAll() {
    message = '';
    try {
      const path = await saveDialog({ defaultPath: 'vellova-profiles.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
      if (!path) return;
      await ipc.saveText(path, JSON.stringify({ rename: $state.snapshot(data.profiles.rename), split: [] }, null, 2));
      message = `Exported ${data.profiles.rename.length} ${data.profiles.rename.length === 1 ? 'profile' : 'profiles'}.`;
    } catch (e) {
      message = `The profiles couldn't be exported: ${clean(e)}`;
    }
  }
  async function importFile() {
    message = '';
    try {
      const path = await open({ filters: [{ name: 'JSON', extensions: ['json'] }] });
      if (!path) return;
      
      const fresh = freshProfiles(data.profiles.rename.map((p) => p.id), importProfiles(new TextDecoder().decode(await ipc.readFile(path))));
      data.profiles.rename = [...data.profiles.rename, ...fresh];
      save('profiles');
      message = fresh.length ? `Imported ${fresh.length} ${fresh.length === 1 ? 'profile' : 'profiles'}.` : 'No new profiles in that file.';
    } catch (e) {
      message = `That file couldn't be read: ${clean(e)}`;
    }
  }
</script>

<div class="row">
  <button class="btn small" onclick={() => void importFile()}>Import…</button>
  <button class="btn small" disabled={!data.profiles.rename.length} onclick={() => void exportAll()}>Export all…</button>
</div>
{#if message}<p class="hint" role="status">{message}</p>{/if}
<p class="hint">To create a profile, set up Rename and choose "Save as new profile".</p>

{#each data.profiles.rename as p (p.id)}
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
    <p class="hint mono">{describe(p)}</p>
    {#if p.desc}<p class="hint">{p.desc}</p>{/if}
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
