export type Action = 'tool-rename' | 'tool-split' | 'undo' | 'close-panel';

/** The app's keyboard shortcuts. `inText`: focus is in a text field, where Ctrl+Z belongs to the field. */
export function shortcut(e: { key: string; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }, inText: boolean): Action | null {
  if (e.key === 'Escape') return 'close-panel';
  if (!e.ctrlKey || e.shiftKey || e.altKey) return null;
  if (e.key === '1') return 'tool-rename';
  if (e.key === '2') return 'tool-split';
  if (e.key.toLowerCase() === 'z' && !inText) return 'undo';
  return null;
}
