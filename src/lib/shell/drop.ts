import type { Tool } from '../app.svelte';

/**
 * The tool that takes files dropped at `x` in a window `width` wide. With `zones` (the tool on screen has no
 * files yet) the left half is Rename and the right half is Split; otherwise they join the list on screen.
 */
export function dropTool(x: number, width: number, current: Tool, zones: boolean): Tool {
  if (!zones) return current;
  return x < width / 2 ? 'rename' : 'split';
}
