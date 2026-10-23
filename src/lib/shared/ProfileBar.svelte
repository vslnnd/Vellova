<script lang="ts">
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

  function saveNew() {
    if (!newName.trim()) return;
    onsave(newName.trim());
    naming = false;
    newName = '';
  }
</script>

<div class="profile" data-tour={tour}>
  <label class="label" for={id}>Profile</label>
  <select {id} class="field" value={current ?? ''} onchange={(e) => onpick(e.currentTarget.value || null)}>
    <option value="">No profile</option>
    {#each profiles as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
  </select>
  <div class="row">
    {#if current}<button class="btn small" onclick={() => onsave()}>Save</button>{/if}
    {#if naming}
      <input class="field grow" aria-label="New profile name" placeholder="Profile name" bind:value={newName} onkeydown={(e) => e.key === 'Enter' && saveNew()} />
      <button class="btn small primary" disabled={!newName.trim()} onclick={saveNew}>Save</button>
    {:else}
      <button class="btn small" onclick={() => (naming = true)}>Save as new profile</button>
    {/if}
  </div>
</div>

<style>
  .profile { display: flex; flex-direction: column; gap: 8px; }
  .grow { flex: 1; min-width: 0; }
</style>
