<script lang="ts" module>
  /** the step whose editor is open (one at a time); -1: none */
  export const stepView = $state({ open: 0 });
</script>

<script lang="ts">
  import { tick } from 'svelte';
  import { extOf, splitPath } from '../shared/names';
  import { data } from '../shared/state.svelte';
  import SummaryCard from '../shared/SummaryCard.svelte';
  import type { Step } from '../shared/types';
  import { NEW_STEP } from './engine/steps';
  import { renameSummary, stepLabel } from './engine/summary';
  import { edited, plan, session } from './session.svelte';
  import StepEditor from './StepEditor.svelte';

  const ADD: [Step['type'], string][] = [
    ['addText', 'Add text'], ['replace', 'Replace'], ['remove', 'Remove'], ['trim', 'Trim spaces'], ['case', 'Change case'],
    ['number', 'Numbering'], ['date', 'Date'], ['pdfPattern', 'Pattern from PDF'], ['pdfValue', 'Value from PDF'], ['list', 'From a list'],
  ];

  const profile = $derived(data.profiles.rename.find((p) => p.id === session.profileId));
  const steps = $derived(session.rules.steps);
  let addMenu = $state<HTMLElement>();

  // new rules (a profile, Reset, the tour) open step 1
  $effect(() => {
    void session.rules;
    stepView.open = 0;
  });

  async function change(key: string) {
    session.editing = true;
    if (key.startsWith('step-')) stepView.open = Number(key.slice(5));
    await tick();
    document.querySelector<HTMLElement>(`[data-part="${key}"]`)?.focus();
  }

  function move(i: number, by: number) {
    const list = session.rules.steps;
    [list[i], list[i + by]] = [list[i + by], list[i]];
    if (stepView.open === i) stepView.open = i + by;
    else if (stepView.open === i + by) stepView.open = i;
  }
  function remove(i: number) {
    session.rules.steps.splice(i, 1);
    if (stepView.open === i) stepView.open = -1;
    else if (stepView.open > i) stepView.open--;
  }
  function add(type: Step['type']) {
    session.rules.steps.push(structuredClone(NEW_STEP[type]));
    stepView.open = session.rules.steps.length - 1;
    addMenu?.hidePopover();
  }

  // the first ready PDF's new name, its value marked; else the first PDF's name as it is
  const example = $derived.by(() => {
    const it = plan.items.find((i) => i.status === 'ready' && extOf(i.source) === '.pdf' && i.name);
    if (!it) {
      const f = session.files.find((x) => extOf(x.path) === '.pdf');
      return f ? { before: splitPath(f.path).name, value: '', after: '' } : null;
    }
    const name = it.name!;
    const n = session.names[it.source];
    const v = n?.ok && n.value ? n.value : '';
    const at = v ? name.indexOf(v) : -1;
    return at < 0 ? { before: name, value: '', after: '' } : { before: name.slice(0, at), value: v, after: name.slice(at + v.length) };
  });
</script>

<div class="settings">
  {#if profile && !edited.value && !session.editing}
    <SummaryCard title={profile.name} summary={renameSummary(session.rules)} onchange={(k) => void change(k)} onedit={() => (session.editing = true)} />
  {:else}
    <div class="card steps">
      <h3>New name</h3>
      <ol>
        {#each steps as s, i (s)}
          <li class="step">
            <div class="head">
              <span class="no" aria-hidden="true">{i + 1}</span>
              <button class="title" data-part="step-{i}" aria-expanded={stepView.open === i} onclick={() => (stepView.open = i)}>{stepLabel(s)}</button>
              <button class="ib sm" aria-label="Move step {i + 1} up" disabled={i === 0} onclick={() => move(i, -1)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 15l6-6 6 6" /></svg>
              </button>
              <button class="ib sm" aria-label="Move step {i + 1} down" disabled={i === steps.length - 1} onclick={() => move(i, 1)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
              </button>
              <button class="ib sm" aria-label="Remove step {i + 1}" onclick={() => remove(i)}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            </div>
            {#if stepView.open === i}<div class="body"><StepEditor step={s} first={i === 0} /></div>{/if}
          </li>
        {/each}
      </ol>
      <button class="link" popovertarget="rn-add" style="anchor-name: --rn-add">+ Add a step: text, numbers, date, replace, case</button>
      <div class="pop menu" id="rn-add" popover bind:this={addMenu} style="position-anchor: --rn-add">
        {#each ADD as [type, label] (type)}<button onclick={() => add(type)}>{label}</button>{/each}
      </div>
    </div>
  {/if}
  {#if example}
    <div class="example">
      <span class="label">Example</span>
      <span class="mono">{example.before}<span class="v">{example.value}</span>{example.after}</span>
    </div>
  {/if}
</div>

<style>
  .settings { flex: 0 0 300px; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 12px; padding: 0 2px 12px; }
  ol { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
  .step { display: flex; flex-direction: column; border-radius: 8px; background: var(--surface2); border: 1px solid var(--border); }
  .head { display: flex; align-items: center; gap: 2px; padding: 4px 4px 4px 10px; }
  .no {
    width: 18px; height: 18px; flex: none; margin-right: 6px; border-radius: 999px; background: var(--cap2); color: var(--text2);
    font-size: 11px; display: inline-flex; align-items: center; justify-content: center;
  }
  .title {
    flex: 1; min-width: 0; height: 28px; padding: 0 4px; border: 0; border-radius: 4px; background: none; text-align: left;
    font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .ib.sm { width: 26px; height: 26px; }
  .ib:disabled { opacity: 0.35; cursor: default; }
  .body { display: flex; flex-direction: column; gap: 8px; padding: 4px 12px 12px; }
  .link { align-self: flex-start; padding: 2px 0; border: 0; background: none; color: var(--accent); font-size: 12.5px; text-align: left; }
  .link:hover { text-decoration: underline; }
  .example { flex: none; margin-top: auto; display: flex; flex-direction: column; gap: 2px; padding: 10px 12px; border-radius: 8px; background: var(--bg); border: 1px solid var(--border); }
  .example .mono { font-size: 13px; overflow-wrap: anywhere; }
  .v { color: var(--accent); }
</style>
