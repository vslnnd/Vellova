import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Grid } from '../src/lib/split/engine/grid';
import { DEFAULT_SPLIT_RULES } from '../src/lib/split/engine/profile';
import type { Batch, FileInfo, Op, SplitProfile } from '../src/lib/shared/types';

const m = vi.hoisted(() => ({
  readFile: vi.fn(), listFiles: vi.fn(), listDir: vi.fn(), applyPlan: vi.fn(), stageWrite: vi.fn(),
  stageClear: vi.fn(), foldersExist: vi.fn(), cancelApply: vi.fn(), readGrid: vi.fn(), writeFile: vi.fn(), open: vi.fn(),
}));
vi.mock('../src/lib/shared/ipc', async (orig) => ({
  ...(await orig<typeof import('../src/lib/shared/ipc')>()),
  ipc: {
    readFile: (p: string) => m.readFile(p),
    listFiles: (p: string[], r: boolean) => m.listFiles(p, r),
    listDir: (d: string[]) => m.listDir(d),
    applyPlan: (b: string, ops: Op[]) => m.applyPlan(b, ops),
    stageWrite: (b: string, n: number, bytes: Uint8Array) => m.stageWrite(b, n, bytes),
    stageClear: (b: string) => m.stageClear(b),
    foldersExist: (p: string[]) => m.foldersExist(p),
    cancelApply: () => m.cancelApply(),
    dataWrite: async () => {},
  },
}));
vi.mock('../src/lib/split/sheets', () => ({
  readGrid: (k: string, e: string, b: Uint8Array, s: string | null) => m.readGrid(k, e, b, s),
  writeFile: (k: string, e: string, b: Uint8Array, r: unknown) => m.writeFile(k, e, b, r),
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: (o: unknown) => m.open(o) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }));

const A = 'C:\\in\\A.xlsx';
const B = 'C:\\in\\B.xlsx';
const ARCH = 'C:\\archive';
const info = (path: string): FileInfo => ({ path, size: 1, mtime: 1, ctime: 1 });
const grid: Grid = { sheets: [{ name: 'Sheet1', rows: 3 }], sheet: 'Sheet1', rows: [['Name', 'Dept'], ['a', 'X'], ['b', 'Y']], merges: [] };
const ok = (ops: Op[]) => ops.map((_, i) => ({ i, ok: true }));

async function load(files = [A], profile?: Partial<SplitProfile>) {
  const s = await import('../src/lib/split/session.svelte');
  const st = await import('../src/lib/shared/state.svelte');
  m.listFiles.mockImplementation(async (p: string[]) => p.filter((x) => x !== 'gone').map(info));
  await s.addPaths(files);
  s.session.rules = { ...DEFAULT_SPLIT_RULES, column: 'Dept', params: ['X', 'Y'].map((value) => ({ value, label: '', payable: true })) };
  if (profile) {
    const p = { id: 'p1', name: 'Q3', desc: '', rules: s.session.rules, archiveFolder: ARCH, ...profile };
    st.data.profiles.split = [p];
    st.data.settings.split.archive = true;
    s.session.profileId = 'p1';
  }
  await s.refresh();
  return { ...s, data: st.data };
}

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('window', {});
  for (const f of Object.values(m)) f.mockReset();
  m.readFile.mockImplementation(async () => new Uint8Array([1]));
  m.listDir.mockResolvedValue([]);
  m.readGrid.mockResolvedValue(grid);
  m.writeFile.mockImplementation(async (_k: string, _e: string, _b: Uint8Array, r: { outputs: unknown[] }) => r.outputs.map((_, i) => new Uint8Array([i])));
  m.stageWrite.mockImplementation(async (_b: string, n: number) => `C:\\stage\\${n}`);
  m.stageClear.mockResolvedValue(undefined);
  m.foldersExist.mockResolvedValue([true]);
  m.open.mockResolvedValue(null);
  m.applyPlan.mockImplementation(async (_b: string, ops: Op[]) => ok(ops));
});

describe('split session', () => {
  it('keeps only spreadsheets, and plans one output per value', async () => {
    const s = await load([A, 'C:\\in\\x.pdf', 'C:\\in\\c.CSV', 'C:\\in\\~$A.xlsx']);
    expect(s.session.files.map((f) => f.path)).toEqual([A, 'C:\\in\\c.CSV']);
    expect(s.plan.items.filter((i) => i.source === A).map((i) => i.label)).toEqual(['X', 'Y']);
  });

  it('stages each output, then copies it from the staged path, then clears staging', async () => {
    const s = await load();
    await s.runBatch();
    const [id, ops] = m.applyPlan.mock.calls[0];
    expect(m.stageWrite.mock.calls.map((c) => [c[0], c[1]])).toEqual([[id, 0], [id, 1]]);
    expect(ops.map((o: Op) => [o.kind, o.from])).toEqual([['copy', 'C:\\stage\\0'], ['copy', 'C:\\stage\\1']]);
    expect(m.stageClear).toHaveBeenCalledWith(id);
    expect(s.data.history[0]).toMatchObject({ id, tool: 'split', verb: 'created', summary: '2 files created' });
    expect(s.data.history[0].rerun).toMatchObject({ files: [A], profileId: null, rules: { column: 'Dept' } });
    expect(s.session.files).toEqual([]);
  });

  it('clears staging even when applying fails', async () => {
    const s = await load();
    m.applyPlan.mockRejectedValue('internal: another batch is running');
    await s.runBatch();
    expect(m.stageClear).toHaveBeenCalledTimes(1);
    expect(s.data.history).toEqual([]);
    expect(s.session.busy).toBe(false);
  });

  it('fails every output of a source that can no longer be read', async () => {
    const s = await load();
    m.readFile.mockRejectedValue('locked: in use');
    await s.runBatch();
    expect(m.applyPlan).not.toHaveBeenCalled();
    expect(s.plan.items.map((i) => [i.status, i.reason])).toEqual([['attention', 'locked'], ['attention', 'locked']]);
  });

  it('does not archive a source whose output failed', async () => {
    const s = await load([A, B], {});
    m.applyPlan.mockImplementationOnce(async (_b: string, ops: Op[]) => ops.map((o, i) => ({ i, ok: !o.to.endsWith('_B_Y.xlsx'), code: 'locked' })));
    await s.runBatch();
    const archive = m.applyPlan.mock.calls[1][1];
    expect(archive.map((o: Op) => [o.kind, o.from])).toEqual([['rename', A]]);
    expect(archive[0].to).toMatch(/^C:\\archive\\A_\d{8}\.xlsx$/);
    expect(s.data.history[0].summary).toBe('4 files created · 1 archived · 1 failed');
    expect(s.session.files.map((f) => f.path)).toEqual([B]);
    expect(s.plan.items.filter((i) => i.status === 'attention').map((i) => i.id)).toEqual([`${B}|1`]);
  });

  it('a locked archive leaves the source listed; Retry runs only its archive inside the same batch', async () => {
    const s = await load([A], {});
    m.applyPlan.mockImplementation(async (_b: string, ops: Op[]) => ops.map((o, i) => (o.kind === 'rename' ? { i, ok: false, code: 'locked', message: 'in use' } : { i, ok: true })));
    await s.runBatch();
    const id = m.applyPlan.mock.calls[0][0];
    expect(s.plan.items).toEqual([expect.objectContaining({ id: `archive:${A}`, source: A, status: 'attention', reason: 'locked' })]);
    expect(s.data.history[0].items.filter((i) => !i.archived).every((i) => i.ok)).toBe(true);
    expect(s.data.history[0].summary).toBe('2 files created · 1 failed');

    m.applyPlan.mockReset();
    m.applyPlan.mockImplementation(async (_b: string, ops: Op[]) => ok(ops));
    await s.retry(`archive:${A}`);
    expect(m.applyPlan).toHaveBeenCalledTimes(1);
    const [again, ops] = m.applyPlan.mock.calls[0];
    expect(again).toBe(id);
    expect(ops.map((o: Op) => [o.kind, o.from])).toEqual([['rename', A]]);
    expect(m.stageWrite).toHaveBeenCalledTimes(2);
    expect(s.data.history.map((h) => h.id)).toEqual([id]);
    expect(s.data.history[0].summary).toBe('3 files created · 1 archived');
    expect(s.session.files).toEqual([]);
    expect(s.plan.items).toEqual([]);
  });

  it('fails the archive loudly when its folder is gone', async () => {
    const s = await load([A], {});
    m.foldersExist.mockResolvedValue([false]);
    await s.runBatch();
    expect(m.applyPlan).toHaveBeenCalledTimes(1);
    expect(s.session.failures[`archive:${A}`]).toEqual({ reason: 'missing', detail: 'The archive folder no longer exists.' });
  });

  it('archives nothing when Settings › archive is off', async () => {
    const s = await load([A], {});
    s.data.settings.split.archive = false;
    expect(s.archiveFolder()).toBeNull();
    await s.runBatch();
    expect(m.applyPlan).toHaveBeenCalledTimes(1);
  });

  it('reads a missing sheet as a no-column problem', async () => {
    m.readGrid.mockRejectedValue(new Error('Sheet not found: Data'));
    const s = await load();
    expect(s.session.reads[A]).toEqual({ ok: false, reason: 'no-column', detail: 'This file has no sheet "Data".' });
  });

  it('while a listed source has written outputs, a plain Apply joins that batch', async () => {
    const C = 'C:\\in\\C.xlsx';
    const s = await load([A]);
    m.applyPlan.mockImplementationOnce(async (_b: string, ops: Op[]) => ops.map((o, i) => ({ i, ok: !o.to.endsWith('_A_Y.xlsx'), code: 'locked' })));
    await s.runBatch();
    const id = m.applyPlan.mock.calls[0][0];
    await s.addPaths([C]);
    await s.refresh();
    await s.runBatch();
    expect(m.applyPlan.mock.calls[1][0]).toBe(id);
    expect(m.applyPlan.mock.calls[1][1].map((o: Op) => o.to)).toEqual([expect.stringMatching(/_C_X\.xlsx$/), expect.stringMatching(/_C_Y\.xlsx$/)]);
    expect(s.plan.items.map((i) => [i.id, i.status])).toEqual([[`${A}|1`, 'attention']]);
    await s.retry(`${A}|1`);
    await s.refresh();
    await s.applyFixes();
    expect(m.applyPlan.mock.calls[2][0]).toBe(id);
    expect(s.data.history.map((h) => h.id)).toEqual([id]);
    expect(s.session.files).toEqual([]);
  });

  it('a run that cannot start keeps the failed archives of the batch before it', async () => {
    const s = await load([A], {});
    m.applyPlan.mockImplementation(async (_b: string, ops: Op[]) => ops.map((o, i) => ({ i, ok: o.kind !== 'rename', code: 'locked' })));
    await s.runBatch();
    s.session.rules.template = '{file}_{group}'; // re-plans: nothing written under these rules, so the next run is a new batch
    m.applyPlan.mockRejectedValue('internal: another batch is running');
    await s.runBatch();
    expect(s.session.failures[`archive:${A}`]).toMatchObject({ reason: 'locked' });
    expect(s.plan.items.map((i) => i.id)).toContain(`archive:${A}`);
  });

  it('records a missing archive folder once per source', async () => {
    const s = await load([A, B], {});
    m.foldersExist.mockResolvedValue([false]);
    await s.runBatch();
    expect(s.data.history[0].items.filter((i) => i.archived).map((i) => [i.from, i.to, i.ok])).toEqual([[A, `${ARCH}\\A.xlsx`, false], [B, `${ARCH}\\B.xlsx`, false]]);
  });

  it('a rules change brings back outputs written under the old rules', async () => {
    const s = await load([A, B]);
    m.applyPlan.mockImplementationOnce(async (_b: string, ops: Op[]) => ops.map((o, i) => ({ i, ok: !o.to.endsWith('_B_Y.xlsx'), code: 'locked' })));
    await s.runBatch();
    expect(s.plan.items.map((i) => i.id)).toEqual([`${B}|1`]);
    s.session.rules.template = '{file}_{group}';
    expect(s.plan.items.map((i) => [i.id, i.status])).toEqual([[`${B}|0`, 'ready'], [`${B}|1`, 'attention']]);
  });

  it('after an Undo, written outputs come back and a failed archive is gone (Retry does nothing)', async () => {
    const s = await load([A], {});
    m.applyPlan.mockImplementation(async (_b: string, ops: Op[]) => ops.map((o, i) => ({ i, ok: o.kind !== 'rename', code: 'locked' })));
    await s.runBatch();
    expect(s.plan.items.map((i) => i.id)).toEqual([`archive:${A}`]);
    s.data.history[0].undone = true;
    expect(s.plan.items.map((i) => [i.id, i.status])).toEqual([[`${A}|0`, 'ready'], [`${A}|1`, 'ready']]);
    m.applyPlan.mockClear();
    await s.retry(`archive:${A}`);
    expect(m.applyPlan).not.toHaveBeenCalled();
    expect(s.session.failures).toEqual({});
  });

  it('after Cancel, a source written in full before it is still archived', async () => {
    const s = await load([A, B], {});
    m.applyPlan.mockImplementationOnce(async (_b: string, ops: Op[]) => {
      s.cancelActivity(); // while copying B's last output
      return ops.map((_, i) => (i < 3 ? { i, ok: true } : { i, ok: false, code: 'cancelled' }));
    });
    await s.runBatch();
    expect(m.cancelApply).toHaveBeenCalled();
    expect(m.applyPlan.mock.calls[1][1].map((o: Op) => o.from)).toEqual([A]);
    expect(s.plan.items.map((i) => [i.id, i.status])).toEqual([[`${B}|1`, 'ready']]);
  });

  it('a Cancel while staging copies nothing and keeps every output listed', async () => {
    const s = await load([A, B]);
    m.stageWrite.mockImplementation(async (_b: string, n: number) => {
      if (n === 2) s.cancelActivity(); // while staging B's first output
      return `C:\\stage\\${n}`;
    });
    await s.runBatch();
    expect(m.applyPlan).not.toHaveBeenCalled();
    expect(m.stageClear).toHaveBeenCalledTimes(1);
    expect(s.plan.items.map((i) => i.status)).toEqual(['ready', 'ready', 'ready', 'ready']);
  });

  it('fails the outputs of a source that changed after the preview', async () => {
    const s = await load([A, B]);
    m.listFiles.mockImplementation(async (p: string[]) => p.map((path) => ({ ...info(path), mtime: path === A ? 2 : 1 })));
    await s.runBatch();
    expect(m.writeFile).toHaveBeenCalledTimes(1);
    expect(m.applyPlan.mock.calls[0][1].map((o: Op) => o.to)).toEqual([expect.stringMatching(/_B_X\.xlsx$/), expect.stringMatching(/_B_Y\.xlsx$/)]);
    const changed = { reason: 'internal', detail: 'This file changed after the preview. Retry to read it again.' };
    expect(s.session.failures).toEqual({ [`${A}|0`]: changed, [`${A}|1`]: changed });
  });

  it('removing a file forgets what was read from it', async () => {
    const s = await load();
    expect(m.readFile).toHaveBeenCalledTimes(1);
    s.removeFile(A);
    await s.addPaths([A]);
    await s.refresh();
    expect(m.readFile).toHaveBeenCalledTimes(2);
  });

  it('clears staging when the run stops between staging and the copy', async () => {
    const s = await load();
    m.writeFile.mockResolvedValue([new Uint8Array([0])]); // one part for two outputs
    await s.runBatch();
    expect(m.stageWrite).toHaveBeenCalledTimes(1);
    expect(m.applyPlan).not.toHaveBeenCalled();
    expect(m.stageClear).toHaveBeenCalledTimes(1);
    expect(s.data.history).toEqual([]);
  });

  it('lists the subfolders the plan uses into existing; a missing one lists as empty', async () => {
    const d = new Date();
    const today = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    m.listDir.mockImplementation(async (dirs: string[]) => (dirs.includes('C:\\in\\X') ? [`C:\\in\\X\\${today}_A_X.xlsx`] : []));
    const s = await load();
    s.session.rules.subfolder = true;
    await s.refresh();
    expect(m.listDir).toHaveBeenLastCalledWith(['C:\\in\\X', 'C:\\in\\Y']);
    expect(s.plan.items.map((i) => i.name)).toEqual([`${today}_A_X (1).xlsx`, `${today}_A_Y.xlsx`]);
  });

  it('shows "Splitting" while writing and "Archiving" while archiving', async () => {
    const s = await load([A], {});
    const { island } = await import('../src/lib/shell/islandState.svelte');
    const labels: (string | undefined)[] = [];
    m.stageWrite.mockImplementation(async (_b: string, n: number) => (labels.push(island.activity?.label), `C:\\stage\\${n}`));
    m.foldersExist.mockImplementation(async () => (labels.push(island.activity?.label), [true]));
    await s.runBatch();
    expect([...new Set(labels)]).toEqual(['Splitting', 'Archiving']);
  });

  it('re-runs with the files that still exist, falling back to the source folder', async () => {
    const s = await load();
    m.foldersExist.mockResolvedValue([false]);
    const b = { rerun: { files: [B, 'gone', 5], rules: { ...DEFAULT_SPLIT_RULES, mode: 'rows', folder: { mode: 'folder', path: 'C:\\old' } }, profileId: null } } as unknown as Batch;
    await s.rerun(b);
    expect(s.session.files.map((f) => f.path)).toEqual([B]);
    expect(s.session.rules).toMatchObject({ mode: 'rows', folder: { mode: 'source' } });
    expect(s.data.log.filter((l) => l.level === 'warn').map((l) => l.file ?? l.message)).toEqual(['gone', expect.stringContaining('C:\\old')]);
  });
});

describe('split Reset and edited', () => {
  const rulesOf = (over = {}) => ({ ...structuredClone(DEFAULT_SPLIT_RULES), column: 'Dept', mode: 'rows' as const, rows: 5, ...over });
  const profile = (): SplitProfile => ({ id: 'p1', name: 'Q3', desc: '', rules: rulesOf(), archiveFolder: ARCH });
  const use = async () => {
    const s = await import('../src/lib/split/session.svelte');
    const st = await import('../src/lib/shared/state.svelte');
    m.listFiles.mockImplementation(async (p: string[]) => p.map(info));
    st.data.profiles.split = [profile()];
    s.useProfile(st.data.profiles.split[0]);
    return { ...s, data: st.data };
  };

  it('is edited once a rule differs from the loaded profile, and not before', async () => {
    const s = await import('../src/lib/split/session.svelte');
    expect(s.edited.value).toBe(false); // no profile loaded
    const loaded = await use();
    expect(loaded.edited.value).toBe(false);
    loaded.session.rules.rows = 6;
    expect(loaded.edited.value).toBe(true);
    loaded.session.rules.rows = 5;
    expect(loaded.edited.value).toBe(false);
  });

  it('compares with the profile as it loads, defaults filled in', async () => {
    const s = await import('../src/lib/split/session.svelte');
    const st = await import('../src/lib/shared/state.svelte');
    st.data.profiles.split = [{ id: 'old', name: 'Old', desc: '', rules: { mode: 'parts', parts: 3 } as never, archiveFolder: null }];
    s.useProfile(st.data.profiles.split[0]);
    expect(s.edited.value).toBe(false);
  });

  it('Reset restores the loaded profile, empties the file list and ends editing', async () => {
    const s = await use();
    await s.addPaths([A, B]);
    s.session.rules.rows = 99;
    s.session.rules.subfolder = true;
    s.session.editing = true;
    s.reset();
    expect(s.session.rules).toEqual(rulesOf());
    expect(s.session.files).toEqual([]);
    expect(s.session.editing).toBe(false);
    expect(s.session.profileId).toBe('p1');
    expect(s.edited.value).toBe(false);
  });

  it('Reset without a profile goes back to the defaults', async () => {
    const s = await load([A]);
    expect(s.session.rules.column).toBe('Dept');
    s.reset();
    expect(s.session.rules).toEqual(DEFAULT_SPLIT_RULES);
    expect(s.session.rules).not.toBe(DEFAULT_SPLIT_RULES);
    expect(s.session.files).toEqual([]);
  });

  it('Reset does nothing while a batch runs', async () => {
    const s = await load([A]);
    s.session.busy = true;
    s.session.editing = true;
    s.reset();
    expect(s.session.files).toHaveLength(1);
    expect(s.session.rules.column).toBe('Dept');
    expect(s.session.editing).toBe(true);
  });

  it('using a profile ends editing', async () => {
    const s = await use();
    s.session.editing = true;
    s.useProfile(s.data.profiles.split[0]);
    expect(s.session.editing).toBe(false);
  });

  it('chooseArchiveFolder keeps the chosen folder in the profile, or nothing when the dialog is cancelled', async () => {
    const s = await use();
    const p = s.data.profiles.split[0];
    m.open.mockResolvedValueOnce('D:\\new');
    await s.chooseArchiveFolder(p);
    expect(m.open).toHaveBeenLastCalledWith({ directory: true, defaultPath: ARCH });
    expect(p.archiveFolder).toBe('D:\\new');
    m.open.mockResolvedValueOnce(null);
    await s.chooseArchiveFolder(p);
    expect(p.archiveFolder).toBe('D:\\new');
  });
});
