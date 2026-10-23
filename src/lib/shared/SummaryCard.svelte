<script lang="ts">
  import type { Summary } from './types';

  let { title, summary, onchange, onedit }: { title: string; summary: Summary; onchange: (key: string) => void; onedit: () => void } = $props();
</script>

<div class="card">
  <h3>{title}</h3>
  <ul>
    {#each summary.lines as line (line.key)}
      <li>
        <span class="label">{line.label}</span>
        <span class="text">{line.text}</span>
        <button class="link" aria-label="Change {line.label}: {line.text}" onclick={() => onchange(line.key)}>Change</button>
      </li>
    {/each}
  </ul>
  <div class="row"><button class="btn small" onclick={onedit}>Edit</button></div>
</div>

<style>
  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
  li { display: grid; grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: 'label label' 'text change'; column-gap: 8px; align-items: baseline; }
  .label { grid-area: label; }
  .text { grid-area: text; font-size: 13px; overflow-wrap: anywhere; }
  .link { grid-area: change; padding: 2px 4px; border: 0; background: none; color: var(--accent); font-size: 12.5px; border-radius: 4px; }
  .link:hover { text-decoration: underline; }
</style>
