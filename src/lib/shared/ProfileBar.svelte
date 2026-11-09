<script lang="ts">
  import { tick } from 'svelte';

  let { id, profiles, current, onpick, onsave, tour }: {
    id: string;
    profiles: { id: string; name: string }[];
    current: string | null;
    onpick: (id: string | null) => void;
    onsave: (name?: string) => void;
    tour?: string;
  } = $props();

  let naming = $state(false);
  let newName = $state('');
  let pick = $state<HTMLSelectElement>();

  /** Ends naming, saved or not, and puts the focus back on the profile list. */
  async function end(save: boolean) {
    if (save && !newName.trim()) return;
    if (save) onsave(newName.trim());
    naming = false;
    newName = '';
    await tick();
    pick?.focus();
  }
  function onkeydown(e: KeyboardEvent) {
    if (e.key !== 'Enter' && e.key !== 'Escape') return;
    e.preventDefault(); // no keypress follows, so Enter can't also press whatever takes the focus next
    e.stopPropagation();
    void end(e.key === 'Enter');
  }
</script>

<div class="profile" data-tour={tour}>
  <label class="label" for={id}>Profile</label>
  <div class="row">
    <select {id} class="field pick" bind:this={pick} value={current ?? ''} onchange={(e) => onpick(e.currentTarget.value || null)}>
      <option value="">No profile</option>
      {#each profiles as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
    </select>
    {#if naming}
      <input class="field name" aria-label="New profile name" placeholder="Profile name" bind:value={newName} {@attach (el) => el.focus()} {onkeydown} />
      <button class="btn small primary" disabled={!newName.trim()} onclick={() => void end(true)}>Save</button>
    {:else}
      {#if current}<button class="btn small" onclick={() => onsave()}>Save</button>{/if}
      <button class="btn icon" title="Save as new profile" aria-label="Save as new profile" onclick={() => (naming = true)}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round" aria-hidden="true"><path d="M5 4h11l3 3v13H5z" /><path d="M8 4v5h7V4M8 20v-6h8v6" /></svg>
      </button>
    {/if}
  </div>
</div>

<style>
  .profile { display: flex; flex-direction: column; gap: 4px; }
  .row { flex-wrap: nowrap; }
  .pick { width: 170px; }
  .name { width: 150px; }
</style>
