import type { Tool } from '../app.svelte';

type Owner = { busy: boolean; loading: boolean };

/** Which tool owns the island's activity: a running batch first, then a read, then the tool on screen. */
export function cancelTarget(split: Owner, rename: Owner, tool: Tool): Tool {
  if (split.busy) return 'split';
  if (rename.busy) return 'rename';
  if (split.loading !== rename.loading) return split.loading ? 'split' : 'rename';
  return tool;
}
