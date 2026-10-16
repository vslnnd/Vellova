import { island, send } from '../shell/islandState.svelte';
import { ipc } from './ipc';
import { data, log, save } from './state.svelte';
import { mergeBatch } from './store';
import type { Batch } from './types';

/** Batches whose undo ran this session. Ctrl+Z skips them, so a partly undone batch cannot trap it; History's Undo still works. */
const attempted = new Set<string>();

/** Stores a finished batch (or merges Apply-fixes results into it) and returns it with its summary. */
export function recordBatch(b: Omit<Batch, 'summary'>): Batch {
  attempted.delete(b.id);
  data.history = mergeBatch(data.history, { ...b, summary: '' });
  save('history');
  return data.history[0];
}

/** Undoes a batch from its journal. Files changed since are left alone and logged; undo can be repeated. */
export async function undoBatch(id: string): Promise<void> {
  const b = data.history.find((h) => h.id === id);
  if (!b || !b.undoable || b.undone || island.activity) return;
  attempted.add(id);
  send({ type: 'start', label: 'Undoing', total: 0, cancellable: false });
  try {
    const r = await ipc.undoBatch(id);
    for (const s of r.skipped) {
      log({ level: 'warn', tool: b.tool, file: s.path, message: 'Not restored: the file changed after the batch, or is in use.', detail: s.reason });
    }
    b.undone = r.skipped.length === 0;
    save('history');
    send({ type: 'stop' });
    const text = `${r.restored} ${r.restored === 1 ? 'name' : 'names'} restored${r.skipped.length ? ` · ${r.skipped.length} skipped` : ''}`;
    send({ type: 'restored', text });
    log({ level: 'info', tool: b.tool, message: `Undo: ${text}.` });
  } catch (e) {
    send({ type: 'stop' });
    log({ level: 'error', tool: b.tool, message: 'Undo failed.', detail: String(e) });
    send({ type: 'restored', text: 'Undo failed · see History › Log' });
  }
}

export async function undoLast(): Promise<void> {
  const b = data.history.find((h) => h.undoable && !h.undone && !attempted.has(h.id));
  if (b) await undoBatch(b.id);
}
