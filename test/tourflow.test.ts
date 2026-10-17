import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Batch, RenameProfile } from '../src/lib/shared/types';

const m = vi.hoisted(() => ({
  listFiles: vi.fn(),
  tourPrepare: vi.fn(),
  tourCleanup: vi.fn(),
  forgetBatch: vi.fn(),
  undoBatch: vi.fn(),
}));
vi.mock('../src/lib/shared/ipc', () => ({
  ipc: {
    listFiles: (p: string[], r: boolean) => m.listFiles(p, r),
    tourPrepare: () => m.tourPrepare(),
    tourCleanup: (d: string) => m.tourCleanup(d),
    forgetBatch: (b: string) => m.forgetBatch(b),
    undoBatch: (b: string) => m.undoBatch(b),
    dataWrite: async () => {},
  },
  ipcReason: () => ({ reason: 'unreadable', detail: '' }),
}));
vi.mock('../src/lib/rename/pdf', () => ({ readPdfItems: async () => [] }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: async () => null }));
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }));

const DIR = 'C:\\Temp\\vellova-tour-7';
const sample = (n: string) => `${DIR}\\${n}`;
const batch = (id: string, from: string[], undoable = true): Batch => ({
  id, tool: 'rename', time: 1, verb: 'renamed', summary: '', items: from.map((f) => ({ from: f, to: f + '.x', ok: true })), undoable,
});
const profile = (id: string) => ({ id, name: id }) as RenameProfile;

/** A promise the test resolves by hand. */
function later<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

async function load() {
  const t = await import('../src/lib/tour/tour.svelte');
  const s = await import('../src/lib/shared/state.svelte');
  const r = await import('../src/lib/rename/session.svelte');
  const i = await import('../src/lib/shell/islandState.svelte');
  return { ...t, data: s.data, session: r.session, addPaths: r.addPaths, send: i.send };
}

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('window', {});
  for (const f of Object.values(m)) f.mockReset();
  m.tourCleanup.mockResolvedValue(undefined);
  m.forgetBatch.mockResolvedValue(undefined);
});

describe('tour cleanup', () => {
  it('removes only the tour batch (History and journals) and the tour profile', async () => {
    const t = await load();
    t.data.history = [batch('real', ['C:\\Real\\a.pdf']), batch('tb', [sample('scan_0011.pdf')])];
    t.data.profiles.rename = [profile('mine'), profile('tp')];
    t.data.settings.tour = { dir: DIR, batch: 'tb', profile: 'tp' };
    await t.tourOnStart();
    expect(t.data.history.map((b) => b.id)).toEqual(['real']);
    expect(m.forgetBatch.mock.calls).toEqual([['tb']]);
    expect(t.data.profiles.rename.map((p) => p.id)).toEqual(['mine']);
    expect(m.tourCleanup).toHaveBeenCalledWith(DIR);
    expect(t.data.settings.tour).toBeNull();
    expect(t.tour.card).toBe('resume');
  });

  it('never removes a real batch whose id is in the marker', async () => {
    const t = await load();
    t.data.history = [batch('real', ['C:\\Real\\a.pdf'])];
    t.data.settings.tour = { dir: DIR, batch: 'real', profile: null };
    await t.tourOnStart();
    expect(t.data.history.map((b) => b.id)).toEqual(['real']);
    expect(m.forgetBatch).not.toHaveBeenCalled();
  });

  it('drops a sample batch the marker never recorded (a crash mid-Apply)', async () => {
    const t = await load();
    t.data.history = [batch('late', [sample('scan_0011.pdf')]), batch('real', ['C:\\Real\\a.pdf'])];
    t.data.settings.tour = { dir: DIR, batch: null, profile: null };
    await t.tourOnStart();
    expect(t.data.history.map((b) => b.id)).toEqual(['real']);
    expect(m.forgetBatch.mock.calls).toEqual([['late']]);
  });

  it('keeps the marker, and offers no resume, when the cleanup fails', async () => {
    const t = await load();
    m.tourCleanup.mockRejectedValue('in use');
    t.data.settings.tour = { dir: DIR, batch: null, profile: null };
    await t.tourOnStart();
    expect(t.data.settings.tour).toEqual({ dir: DIR, batch: null, profile: null });
    expect(t.tour.card).toBeNull();
  });

  it('after Finish or Skip, a cleanup that failed is retried at the next start without "Resume"', async () => {
    const t = await load();
    t.startTour();
    m.tourPrepare.mockResolvedValue(DIR);
    await t.beginSamples();
    m.tourCleanup.mockRejectedValue('in use');
    await t.endTour();
    expect(t.data.settings.tour?.ended).toBe(true);
    m.tourCleanup.mockResolvedValue(undefined);
    await t.tourOnStart();
    expect(t.data.settings.tour).toBeNull();
    expect(t.tour.card).toBeNull();
  });
});

describe('tour start', () => {
  it('refuses non-sample paths from startTour on, before the samples exist', async () => {
    const t = await load();
    t.startTour();
    m.listFiles.mockResolvedValue([{ path: 'C:\\Real\\a.pdf', size: 1, mtime: 1 }]);
    await t.addPaths(['C:\\Real']);
    expect(t.session.files).toEqual([]);
  });

  it('does not start while a batch is renaming', async () => {
    const t = await load();
    t.session.busy = true;
    t.startTour();
    expect(t.tourActive()).toBe(false);
  });

  it('a double Start makes one folder and lands on the drop step', async () => {
    const t = await load();
    t.startTour();
    const p = later<string>();
    m.tourPrepare.mockReturnValue(p.promise);
    const a = t.beginSamples();
    const b = t.beginSamples();
    p.resolve(DIR);
    await Promise.all([a, b]);
    expect(m.tourPrepare).toHaveBeenCalledTimes(1);
    expect(t.current()?.id).toBe('drop');
    expect(t.data.settings.tour?.dir).toBe(DIR);
  });

  it('ending while the samples are copied removes the late folder and leaves no marker', async () => {
    const t = await load();
    t.startTour();
    const p = later<string>();
    m.tourPrepare.mockReturnValue(p.promise);
    const a = t.beginSamples();
    await t.endTour();
    p.resolve(DIR);
    await a;
    expect(m.tourCleanup).toHaveBeenCalledWith(DIR);
    expect(t.data.settings.tour).toBeNull();
    expect(t.tourActive()).toBe(false);
  });
});

describe('undoTour', () => {
  it('undoes the tour batch only, never the newest real one', async () => {
    const t = await load();
    t.data.history = [batch('tb', [sample('scan_0011.pdf')], false), batch('real', ['C:\\Real\\a.pdf'])];
    t.session.batch = 'tb';
    await t.undoTour(); // every sample op failed: nothing to undo
    expect(m.undoBatch).not.toHaveBeenCalled();
    t.data.history[0].undoable = true;
    m.undoBatch.mockResolvedValue({ restored: 0, skipped: [{ path: sample('scan_0011.pdf'), reason: 'in use' }] });
    await t.undoTour();
    t.send({ type: 'clearTransient' });
    await t.undoTour(); // a skipped sample: the second Undo retries the tour batch, not the real one
    expect(m.undoBatch.mock.calls).toEqual([['tb'], ['tb']]);
    t.session.batch = null;
    t.send({ type: 'clearTransient' });
    await t.undoTour();
    expect(m.undoBatch).toHaveBeenCalledTimes(2);
  });
});
