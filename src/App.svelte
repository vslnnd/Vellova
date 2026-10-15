<script lang="ts">
  import { flushSync } from 'svelte';
  import { setTheme, ui } from './lib/app.svelte';
  import { switchTheme } from './lib/shell/theme';
</script>

<main style="padding: 24px; display: grid; gap: 12px; max-width: 420px">
  <h1>Vellova</h1>
  <p class="hint">Tokens, fonts and the circle reveal.</p>
  <div class="card"><span class="mono">INV-2026-00017.pdf</span><span class="pill ok">Ready</span></div>
  <button class="btn primary" onclick={(e) => switchTheme(() => { setTheme(ui.dark ? 'light' : 'dark'); flushSync(); }, e.currentTarget)}>
    Switch theme
  </button>
</main>
