<script lang="ts">
  import { flushSync } from 'svelte';
  import { setTheme, ui, type PanelName } from '../app.svelte';
  import { data, save } from '../shared/state.svelte';
  import { chips, layer, layerText, noticeText, TIMEOUT_MS, type Layer, type Notice } from './island';
  import { island, send } from './islandState.svelte';
  import { switchTheme } from './theme';

  let { oncancel, onundo, onrestart }: { oncancel: () => void; onundo: () => void; onrestart: () => void } = $props();

  const active = $derived(layer(island));
  const text = $derived(layerText(island));
  const shown = $derived(chips(island));
  const pct = $derived(island.activity?.total ? (100 * island.activity.done) / island.activity.total : 0);
  const w: Partial<Record<Layer, number>> = $state({});

  // notices fold into their chip after a while; "restored" just goes away
  $effect(() => {
    const ms = TIMEOUT_MS[active];
    if (!ms) return;
    const t = setTimeout(() => send({ type: 'collapse' }), ms);
    return () => clearTimeout(t);
  });

  const toggle = (p: PanelName) => (ui.panel = ui.panel === p ? null : p);
  function review() {
    ui.panel = 'attention';
    send({ type: 'collapse' });
  }
  function toggleTheme(e: MouseEvent) {
    const next = ui.dark ? 'light' : 'dark';
    data.settings.theme = next;
    save('settings');
    switchTheme(() => {
      setTheme(next);
      flushSync();
    }, e.currentTarget as HTMLElement);
  }
  const CHIP: Record<Notice, { action: string; run: () => void }> = {
    attention: { action: 'Review', run: review },
    done: { action: 'Undo', run: () => onundo() },
    update: { action: 'Restart', run: () => onrestart() },
  };
</script>

<nav class="island" class:attn={active === 'attention'} class:okpulse={active === 'done'} aria-label="Main" style:width="{(w[active] ?? 380) + 2}px">
  <span class="sr" aria-live="polite">{text}</span>

  <div class="layer" class:on={active === 'tools'} bind:offsetWidth={w.tools}>
    <div class="tools" role="group" aria-label="Tool">
      <span class="slider" aria-hidden="true" style:left="{ui.tool === 'rename' ? 0 : 108}px" style:width="{ui.tool === 'rename' ? 108 : 92}px"></span>
      <button class="tool" class:on={ui.tool === 'rename'} aria-pressed={ui.tool === 'rename'} style:width="108px" title="Rename (Ctrl+1)" onclick={() => (ui.tool = 'rename')}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7V5h16v2" /><path d="M12 5v14" /><path d="M9 19h6" /></svg>Rename
      </button>
      <button class="tool" class:on={ui.tool === 'split'} aria-pressed={ui.tool === 'split'} style:width="92px" title="Split (Ctrl+2)" onclick={() => (ui.tool = 'split')}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="7" height="16" rx="1.5" /><rect x="14" y="4" width="7" height="16" rx="1.5" /></svg>Split
      </button>
    </div>
    <span class="divider" aria-hidden="true"></span>
    <button class="ib" aria-label="History" aria-pressed={ui.panel === 'history'} onclick={() => toggle('history')}>
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
    </button>
    <button class="ib" aria-label="Profiles" aria-pressed={ui.panel === 'profiles'} onclick={() => toggle('profiles')}>
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h12v18l-6-4-6 4z" /></svg>
    </button>
    <button class="ib" aria-label="Settings" aria-pressed={ui.panel === 'settings'} onclick={() => toggle('settings')}>
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></svg>
    </button>
    <button class="ib theme" class:dark={ui.dark} aria-label={ui.dark ? 'Switch to light theme' : 'Switch to dark theme'} onclick={toggleTheme}>
      <svg class="sun" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
      <svg class="moon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" /></svg>
    </button>
    {#each shown as c (c)}
      <div class="chip {c}">
        <span class="chip-icon" class:nudge3={c === 'update'} aria-hidden="true">
          {#if c === 'done'}
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14L4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-3" /></svg>
          {:else if c === 'attention'}
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l10 18H2z" /><path d="M12 10v5M12 18v.5" /></svg>
          {:else}
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></svg>
          {/if}
        </span>
        <span class="chip-text">{noticeText(island, c)}</span>
        <button class={c === 'done' ? 'act' : 'out'} onclick={CHIP[c].run}>{CHIP[c].action}</button>
      </div>
    {/each}
  </div>

  <div class="layer note" class:on={active === 'working'} bind:offsetWidth={w.working}>
    <span class="wtext">{active === 'working' ? text : ''}</span>
    <span class="bar" aria-hidden="true">
      {#if !island.activity?.total}<span class="indet"></span>{/if}
      <span class="fill" style:width="{pct}%"><span class="sheen"></span></span>
    </span>
    {#if island.activity?.cancellable}<button class="out quiet" onclick={oncancel}>Cancel</button>{/if}
  </div>

  <div class="layer note" class:on={active === 'done'} bind:offsetWidth={w.done}>
    <span class="icon">
      {#if active === 'done'}<svg class="check" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--ok)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>{/if}
    </span>
    <span class="msg">{island.done}</span>
    <button class="act" onclick={onundo}>Undo</button>
  </div>

  <div class="layer note" class:on={active === 'attention'} bind:offsetWidth={w.attention}>
    <span class="icon warn">
      {#if active === 'attention'}<svg class="pop" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l10 18H2z" /><path d="M12 10v5M12 18v.5" /></svg>{/if}
    </span>
    <span class="msg">{noticeText(island, 'attention')}</span>
    <button class="out" onclick={review}>Review</button>
  </div>

  <div class="layer note" class:on={active === 'update'} bind:offsetWidth={w.update}>
    <span class="icon accent">
      {#if active === 'update'}<svg class="dropnudge" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></svg>{/if}
    </span>
    <span class="msg">Update ready</span>
    <button class="out" onclick={onrestart}>Restart</button>
  </div>

  <div class="layer note" class:on={active === 'restarting'} bind:offsetWidth={w.restarting}>
    <svg class="spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.2-8.6" /></svg>
    <span class="msg">{active === 'restarting' ? text : ''}</span>
  </div>

  <div class="layer note" class:on={active === 'restored'} bind:offsetWidth={w.restored}>
    <span class="icon muted">
      {#if active === 'restored'}<svg class="pop" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14L4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-3" /></svg>{/if}
    </span>
    <span class="msg">{active === 'restored' ? text : ''}</span>
  </div>
</nav>

<style>
  .island {
    position: relative; height: 44px; border-radius: 999px; background: var(--cap); border: 1px solid var(--border);
    box-shadow: var(--shadow); overflow: hidden; transition: width 440ms var(--spring);
  }
  .island :focus-visible { outline-offset: -2px; }
  .island.attn { animation: shake 460ms cubic-bezier(0.36, 0.07, 0.19, 0.97) 1, glow 1.3s ease-in-out 460ms 3; }
  .island.okpulse { animation: okring 900ms ease-out 1; }

  .layer {
    position: absolute; top: 0; bottom: 0; left: 50%; display: flex; align-items: center; gap: 2px; padding: 0 3px;
    white-space: nowrap; transform: translateX(-50%) scale(0.92); opacity: 0; filter: blur(6px); pointer-events: none; visibility: hidden;
    transition: opacity 240ms ease, transform 440ms var(--spring), filter 240ms ease, visibility 0s linear 260ms;
  }
  .layer.on {
    transform: translateX(-50%); opacity: 1; filter: none; pointer-events: auto; visibility: visible;
    transition: opacity 240ms ease, transform 440ms var(--spring), filter 240ms ease, visibility 0s linear 0s;
  }
  .layer.note { gap: 10px; padding: 0 6px 0 14px; }
  .layer .ib { width: 36px; height: 36px; }
  .msg, .wtext { font-size: 13.5px; font-weight: 500; }
  .wtext { min-width: 140px; font-variant-numeric: tabular-nums; }
  .icon { width: 22px; height: 22px; display: inline-flex; align-items: center; justify-content: center; }
  .icon.warn { color: var(--warn); } .icon.accent { color: var(--accent); } .icon.muted { color: var(--text2); }

  .tools { position: relative; display: flex; }
  .slider { position: absolute; top: 0; bottom: 0; border-radius: 999px; background: var(--accent); transition: left 300ms cubic-bezier(0.3, 1.3, 0.5, 1), width 300ms cubic-bezier(0.3, 1.3, 0.5, 1); }
  .tool {
    position: relative; height: 36px; border: 0; border-radius: 999px; background: transparent; color: var(--text2);
    display: inline-flex; align-items: center; justify-content: center; gap: 8px; font-size: 13.5px; font-weight: 500;
    transition: color 220ms ease, transform 160ms var(--press);
  }
  .tool:hover { color: var(--text); }
  .tool:active { transform: scale(0.95); }
  .tool.on, .tool.on:hover { color: var(--on-accent); font-weight: 600; }
  .divider { width: 1px; height: 20px; margin: 0 4px; background: var(--border2); }

  .theme { position: relative; }
  .theme svg { position: absolute; transition: opacity 260ms ease, transform 460ms cubic-bezier(0.34, 1.4, 0.64, 1); }
  .theme .sun { opacity: 0; transform: rotate(90deg) scale(0.4); }
  .theme .moon { opacity: 1; transform: none; }
  .theme.dark .sun { opacity: 1; transform: none; }
  .theme.dark .moon { opacity: 0; transform: rotate(-90deg) scale(0.4); }

  .act, .out {
    height: 30px; padding: 0 13px; border-radius: 999px; font-size: 12.5px; transition: filter 160ms ease, background 160ms ease, transform 160ms var(--press);
  }
  .act { border: 0; background: var(--accent); color: var(--on-accent); font-weight: 600; }
  .act:hover { filter: brightness(1.1); }
  .out { border: 1px solid var(--border2); background: transparent; color: var(--text); font-weight: 500; }
  .out:hover { background: var(--hover); }
  .out.quiet { border-color: transparent; }
  .act:active, .out:active { transform: scale(0.94); }

  .chip {
    display: flex; align-items: center; height: 36px; width: 36px; flex-shrink: 0; margin-left: 2px; border-radius: 999px; overflow: hidden;
    transition: width 400ms var(--spring), background 200ms ease; animation: pop 420ms cubic-bezier(0.34, 1.56, 0.64, 1) both;
  }
  .chip.done { background: var(--cap2); color: var(--text2); animation: slidein 560ms cubic-bezier(0.34, 1.4, 0.64, 1) both; }
  .chip.attention { background: var(--warnsoft); color: var(--warn); }
  .chip.update { background: var(--soft); color: var(--accent); }
  .chip:hover, .chip:focus-within { width: max-content; }
  .chip-icon { width: 36px; height: 36px; flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; }
  .chip-icon.nudge3 svg { animation: nudge 2.2s ease-in-out 700ms 3; }
  .chip:hover .chip-icon.nudge3 svg { animation: nudge 2.2s ease-in-out infinite; }
  .chip-text { font-size: 13px; font-weight: 500; color: var(--text); }
  .chip button { margin: 0 3px 0 10px; }
  .chip-text, .chip button { opacity: 0; transition: opacity 200ms ease; }
  .chip:hover .chip-text, .chip:focus-within .chip-text, .chip:hover button, .chip:focus-within button { opacity: 1; transition-delay: 120ms; }

  .bar { position: relative; width: 140px; height: 6px; border-radius: 999px; background: var(--track); overflow: hidden; }
  .fill { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 999px; background: var(--accent); overflow: hidden; transition: width 420ms cubic-bezier(0.2, 0.8, 0.2, 1); }
  .indet { position: absolute; top: 0; bottom: 0; width: 40%; border-radius: 999px; background: var(--accent); animation: indet 1.15s cubic-bezier(0.45, 0, 0.25, 1) infinite; }
  .sheen { position: absolute; inset: 0; background: linear-gradient(100deg, transparent 25%, var(--sheen) 50%, transparent 75%); background-size: 220% 100%; animation: sheen 1.5s linear infinite; }

  .check { animation: pop 420ms cubic-bezier(0.34, 1.56, 0.64, 1) both; }
  .check path { stroke-dasharray: 24; stroke-dashoffset: 24; animation: draw 420ms cubic-bezier(0.65, 0, 0.35, 1) 180ms forwards; }
  .pop { animation: pop 420ms cubic-bezier(0.34, 1.56, 0.64, 1) both; }
  .dropnudge { animation: drop 620ms cubic-bezier(0.34, 1.56, 0.64, 1) both, nudge 2.2s ease-in-out 900ms infinite; }
  .spin { animation: spin 900ms linear infinite; }

  @keyframes shake { 0%, 100% { transform: translateX(0); } 18% { transform: translateX(-3px); } 36% { transform: translateX(3px); } 54% { transform: translateX(-2px); } 72% { transform: translateX(2px); } 88% { transform: translateX(-1px); } }
  @keyframes glow { 0%, 100% { box-shadow: var(--shadow); } 50% { box-shadow: 0 0 0 3px var(--glow1), 0 0 30px 6px var(--glow2); } }
  @keyframes okring { 0% { box-shadow: var(--shadow), 0 0 0 0 var(--okring); } 100% { box-shadow: var(--shadow), 0 0 0 12px transparent; } }
  @keyframes draw { to { stroke-dashoffset: 0; } }
  @keyframes pop { 0% { transform: scale(0.3); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
  @keyframes drop { 0% { transform: translateY(-8px); opacity: 0; } 55% { transform: translateY(1px); opacity: 1; } 100% { transform: translateY(0); opacity: 1; } }
  @keyframes nudge { 0%, 55%, 100% { transform: translateY(0); } 64% { transform: translateY(3px); } 73% { transform: translateY(-1px); } 82% { transform: translateY(2px); } 90% { transform: translateY(0); } }
  @keyframes slidein { 0% { transform: translateX(-28px) scale(0.5); opacity: 0; } 100% { transform: translateX(0) scale(1); opacity: 1; } }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes indet { 0% { left: -40%; } 100% { left: 100%; } }
  @keyframes sheen { from { background-position: 160% 0; } to { background-position: -60% 0; } }
</style>
