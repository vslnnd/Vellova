<script lang="ts">
  import { ask, open, save as saveDialog } from '@tauri-apps/plugin-dialog';
  import { ui } from '../app.svelte';
  import { freshProfiles, importProfiles } from '../migrate/nomina';
  import { pathKey } from '../rename/engine/files';
  import { renameSummary } from '../rename/engine/summary';
  import { useProfile } from '../rename/session.svelte';
  import { ipc } from '../shared/ipc';
  import { data, save } from '../shared/state.svelte';
  import type { RenameProfile, SplitProfile } from '../shared/types';
  import { splitSummary } from '../split/engine/summary';
  import { chooseArchiveFolder, useProfile as useSplit } from '../split/session.svelte';

  type Any = RenameProfile | SplitProfile;
  let kind = $state<'rename' | 'split'>(ui.tool);
  const shown = $derived<Any[]>(data.profiles[kind]);
  let editing = $state<string | null>(null);
  let message = $state('');
  const clean = (e: unknown) => String(e).replace(/^[a-z]+: /, '');

  /** The profile's settings as label and value pairs; what is switched off is left out (the archive folder has its own line). */
  const lines = (p: Any) =>
    (kind === 'split' ? splitSummary((p as SplitProfile).rules, null) : renameSummary(p as RenameProfile)).lines.filter((l) => l.text !== 'Off');
  function use(p: Any) {
    if (kind === 'split') useSplit(p as SplitProfile);
    else useProfile(p as RenameProfile);
    ui.tool = kind;
    ui.panel = null;
  }
  /** Another split profile that archives into the same folder. */
  const sharedWith = (p: SplitProfile) =>
    p.archiveFolder ? data.profiles.split.find((x) => x.id !== p.id && x.archiveFolder && pathKey(x.archiveFolder) === pathKey(p.archiveFolder!))?.name : undefined;
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
  <div class="seg" role="group" aria-label="Profiles for">
    <button aria-pressed={kind === 'rename'} onclick={() => ((kind = 'rename'), (editing = null))}>Rename</button>
    <button aria-pressed={kind === 'split'} onclick={() => ((kind = 'split'), (editing = null))}>Split</button>
  </div>
  {#if message}<span class="status" role="status">{message}</span>{/if}
  <span class="grow"></span>
  <button class="btn small" onclick={() => void importFile()}>Import…</button>
  <button class="btn small" disabled={!data.profiles.rename.length && !data.profiles.split.length} onclick={() => void exportAll()}>Export all…</button>
</div>

{#if shown.length}
  <div class="grid">
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
        <dl>
          {#each lines(p) as l (l.key)}<dt>{l.label}</dt><dd>{l.text}</dd>{/each}
          {#if kind === 'split'}
            {@const sp = p as SplitProfile}
            <dt>Archive folder</dt>
            <dd class="arch">
              <span class="mono clip" title={sp.archiveFolder ?? undefined}>{sp.archiveFolder || 'None'}</span>
              <button class="btn small" onclick={() => void chooseArchiveFolder(sp)}>Choose…</button>
              {#if sp.archiveFolder}<button class="btn small" onclick={() => ((sp.archiveFolder = null), save('profiles'))}>Clear</button>{/if}
            </dd>
            {#if sharedWith(sp)}<dt></dt><dd class="warn">Also used by "{sharedWith(sp)}".</dd>{/if}
          {/if}
        </dl>
        {#if p.desc}<p class="desc">{p.desc}</p>{/if}
        <div class="row acts">
          <button class="btn small primary" onclick={() => use(p)}>Use</button>
          <span class="grow"></span>
          <button class="ib" title="Rename" aria-label="Rename {p.name}" onclick={() => (editing = p.id)}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="M13.5 6.5l4 4" /></svg>
          </button>
          <button class="ib" title="Duplicate" aria-label="Duplicate {p.name}" onclick={() => duplicate(p)}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></svg>
          </button>
          <button class="ib" title="Delete" aria-label="Delete {p.name}" onclick={() => void remove(p)}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></svg>
          </button>
        </div>
      </div>
    {/each}
  </div>
{:else}
  <p class="none" role="status">No profiles yet.</p>
{/if}

<style>
  .grow { flex: 1; }
  .status { font-size: 12.5px; color: var(--text2); }
  .none { margin: 24px 0; text-align: center; color: var(--text3); }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 14px; align-items: start; }
  .card { gap: 12px; padding: 16px; }
  h3 { font-size: 15px; }
  dl { margin: 0; display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 6px 14px; align-items: baseline; }
  dt { font-size: 12px; color: var(--text3); }
  dd { margin: 0; font-size: 13px; overflow-wrap: anywhere; }
  .arch { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
  .clip { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12.5px; }
  .warn { color: var(--warnink); font-size: 12.5px; }
  .desc { margin: 0; font-size: 13px; color: var(--text2); }
  .acts { flex-wrap: nowrap; gap: 2px; }
</style>
