<script lang="ts">
  import Island from './lib/shell/Island.svelte';
</script>

<div style="display: grid; place-items: center; height: 60px; background: var(--chrome)">
  <Island oncancel={() => {}} onundo={() => {}} onrestart={() => {}} />
</div>
