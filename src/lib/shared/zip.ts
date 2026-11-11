import { openPath } from '@tauri-apps/plugin-opener';
import { pathKey } from '../rename/engine/files';
import { island, send } from '../shell/islandState.svelte';
import type { OpenTarget } from '../shell/island';
import { ipc } from './ipc';
import { data, log, save } from './state.svelte';
import { canZip, zipLayout, zipPath, zipSources } from './zipPlan';

/**
 * Packs what a batch made into one .zip beside it. The zip joins the batch (same journal), so Undo sends it
 * to the Recycle Bin with everything else. The files themselves stay where they are.
 */
export async function zipBatch(id: string): Promise<void> {
  const b = data.history.find((h) => h.id === id);
  if (!canZip(b) || island.activity) return;
  const { dir, entries } = zipLayout(zipSources(b));
  // what the island goes back to afterwards
  const { attention, attentionTool } = island;
  send({ type: 'start', label: 'Zipping', total: entries.length, cancellable: false });
  let staged = false;
  try {
    const { default: JSZip } = await import('jszip');
    const zip = new JSZip();
    // JSZip writes a date's UTC fields as the entry's (zone-less) time: shifted, so the zip shows local time
    const now = new Date();
    const date = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
    for (const [k, e] of entries.entries()) {
      zip.file(e.name, await ipc.readFile(e.path), { date });
      send({ type: 'progress', done: k + 1, total: entries.length });
    }
    const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    const to = zipPath(dir, b.tool, new Date(), new Set((await ipc.listDir([dir])).map(pathKey)));
    staged = true;
    const from = await ipc.stageWrite(id, 0, bytes);
    const [r] = await ipc.applyPlan(id, [{ kind: 'copy', from, to }]);
    if (!r?.ok) throw new Error(r?.message ?? 'The zip could not be written.');
    b.items.push({ from: '', to, ok: true, zip: true });
    save('history');
    log({ level: 'info', tool: b.tool, message: `${entries.length} ${entries.length === 1 ? 'file' : 'files'} zipped`, file: to });
    send({ type: 'finish', text: `${b.summary} · zipped`, attention, tool: attentionTool ?? undefined, open: { folder: dir, file: to } });
  } catch (e) {
    log({ level: 'error', tool: b.tool, message: 'The zip could not be made.', detail: String((e as Error)?.message ?? e) });
    send({ type: 'stop' });
    send({ type: 'restored', text: "Couldn't zip · see History › Log", keep: true });
  } finally {
    if (staged) await ipc.stageClear(id).catch(() => {});
  }
}

/** The Done island's Zip button: the newest batch. */
export const zipLast = () => (data.history[0] ? zipBatch(data.history[0].id) : Promise.resolve());

/** After a batch: a zip when its rules ask for one, and the folder opened when Settings says so. */
export async function afterBatch(id: string, open: OpenTarget | null, zip: boolean | undefined) {
  if (zip) await zipBatch(id);
  if (data.settings.openWhenDone && open) {
    await openPath(open.folder).catch((e) => log({ level: 'warn', tool: 'app', file: open.folder, message: "Couldn't open the folder.", detail: String(e) }));
  }
}
