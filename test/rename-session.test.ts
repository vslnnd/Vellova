import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Grid } from '../src/lib/split/engine/grid';
import type { FileInfo, Step } from '../src/lib/shared/types';
import { listKey } from '../src/lib/rename/engine/steps';

const m = vi.hoisted(() => ({ readFile: vi.fn(), listFiles: vi.fn(), listDir: vi.fn(), readPdfText: vi.fn(), readGrid: vi.fn() }));
vi.mock('../src/lib/shared/ipc', async (orig) => ({
  ...(await orig<typeof import('../src/lib/shared/ipc')>()),
  ipc: {
    readFile: (p: string) => m.readFile(p),
    listFiles: (p: string[], r: boolean) => m.listFiles(p, r),
    listDir: (d: string[]) => m.listDir(d),
    applyPlan: async () => [],
    cancelApply: async () => {},
    dataWrite: async () => {},
  },
}));
vi.mock('../src/lib/rename/pdf', () => ({ readPdfText: (b: Uint8Array) => m.readPdfText(b) }));
vi.mock('../src/lib/split/sheets', () => ({
  readGrid: (k: string, e: string, b: Uint8Array, s: string | null) => m.readGrid(k, e, b, s),
  callSheetWorker: async () => ({ kind: 'text', text: '' }),
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: async () => null }));
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }));

const A = 'C:\\in\\a.pdf';
const B = 'C:\\in\\b.pdf';
const LIST = 'C:\\lists\\names.xlsx';
const info = (path: string): FileInfo => ({ path, size: 1, mtime: 1, ctime: 1 });
const grid: Grid = { sheets: [{ name: 'Sheet1', rows: 2 }], sheet: 'Sheet1', rows: [['File', 'Client', 'Code'], ['a', 'Acme', 'A1']], merges: [] };
const listStep: Step = { type: 'list', path: LIST, match: 'File', name: 'Client', against: 'name' };

async function load(steps: Step[], files = [A, B]) {
  const s = await import('../src/lib/rename/session.svelte');
  m.listFiles.mockImplementation(async (p: string[]) => p.map(info));
  await s.addPaths(files);
  s.session.rules = { ...s.session.rules, steps };
  await s.refresh();
  return s;
}

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('window', {});
  for (const f of Object.values(m)) f.mockReset();
  m.readFile.mockImplementation(async () => new Uint8Array([1]));
  m.listDir.mockResolvedValue([]);
  m.readGrid.mockResolvedValue(grid);
  m.readPdfText.mockResolvedValue({ items: [], title: '', created: '' });
});

describe('rename session with steps', () => {
  it('a list step names the PDFs it maps; the others need attention', async () => {
    const s = await load([listStep]);
    expect(s.plan.items.map((i) => [i.status, i.name, i.reason])).toEqual([
      ['ready', 'Acme.pdf', undefined],
      ['attention', undefined, 'not-in-list'],
    ]);
    expect(m.readGrid).toHaveBeenCalledTimes(1);
    expect(m.readPdfText).not.toHaveBeenCalled();
  });

  it('a list open in another program puts every PDF in attention with that reason', async () => {
    m.readFile.mockImplementation(async (p: string) => {
      if (p === LIST) throw 'locked: The process cannot access the file.';
      return new Uint8Array([1]);
    });
    const s = await load([listStep]);
    expect(s.plan.items.map((i) => i.reason)).toEqual(['not-in-list', 'not-in-list']);
    for (const i of s.plan.items) expect(i.detail).toMatch(/open in another program/);
    expect(s.session.listErrors).toEqual({ [listKey(listStep)]: 'The list file is open in another program.' });
    m.readFile.mockImplementation(async () => new Uint8Array([1]));
    await s.refresh(); // Read again, once the list is closed
    expect(s.session.listErrors).toEqual({});
    expect(s.plan.items[0].name).toBe('Acme.pdf');
  });

  it('steps that need no PDF text never read the PDFs', async () => {
    const s = await load([{ type: 'addText', prefix: 'X_', suffix: '' }]);
    expect(s.plan.items.map((i) => i.name)).toEqual(['X_a.pdf', 'X_b.pdf']);
    expect(m.readPdfText).not.toHaveBeenCalled();
  });

  it('PDF text and its value feed the name; an empty first keyword waits', async () => {
    m.readPdfText.mockResolvedValue({ items: [{ str: 'No.: DN-100', x: 0, y: 0, page: 1 }], title: '', created: '' });
    const s = await load([{ type: 'pdfPattern', preset: 'invoice', regex: '', occurrence: 1 }]);
    expect(s.plan.items.map((i) => i.name)).toEqual(['DN-100.pdf', 'DN-100 (1).pdf']);
    s.session.rules = { ...s.session.rules, steps: [{ type: 'pdfValue', keyword: '', position: 'after', occurrence: 1 }] };
    await s.refresh();
    expect(s.plan.items.map((i) => [i.status, i.detail])).toEqual([['pending', 'Enter a keyword to find the value.'], ['pending', 'Enter a keyword to find the value.']]);
  });

  it('a broken custom pattern makes PDFs wait with its error', async () => {
    const s = await load([{ type: 'pdfPattern', preset: 'custom', regex: '(', occurrence: 1 }]);
    expect(s.plan.items.every((i) => i.status === 'pending' && /Invalid regular expression/.test(i.detail ?? ''))).toBe(true);
    expect(m.readPdfText).not.toHaveBeenCalled();
  });

  it('lists every expanded target folder, and a typed name on a failed PDF gets its own {n}', async () => {
    const s = await load([listStep]);
    s.session.rules = { ...s.session.rules, destination: { mode: 'move', folder: 'D:\\out\\{value}-{n}' } };
    s.setName(B, 'Mine');
    await s.refresh();
    expect(m.listDir.mock.calls.at(-1)![0].sort()).toEqual(['D:\\out\\_-1', 'D:\\out\\_-2']);
    expect(s.plan.items[1].op?.to).toBe('D:\\out\\_-2\\Mine.pdf');
  });

  it('two list steps on one file use their own columns, and the file is parsed once per version', async () => {
    const code: Step = { type: 'list', path: LIST, match: 'Client', name: 'Code', against: 'name' };
    const s = await load([listStep, code]);
    expect(s.plan.items[0].name).toBe('A1.pdf');
    await s.refresh();
    expect(m.readGrid).toHaveBeenCalledTimes(1);
    expect(m.readGrid.mock.calls[0][0]).toBe(`list|${LIST}|1|1`);
  });

  it('keeps the names shown while it reads again', async () => {
    m.readPdfText.mockResolvedValue({ items: [], title: 'T', created: '' });
    const title: Step = { type: 'pdfPattern', preset: 'title', regex: '', occurrence: 1 };
    const s = await load([title]);
    s.session.rules.steps = [title, { type: 'addText', prefix: 'Y_', suffix: '' }];
    const done = s.refresh(); // stops at its first await
    expect(s.plan.items.map((i) => i.name)).toEqual(['T.pdf', 'T (1).pdf']);
    await done;
    expect(s.plan.items.map((i) => i.name)).toEqual(['Y_T.pdf', 'Y_T (1).pdf']);
  });

  it('loads a profile kept in app state', async () => {
    const s = await import('../src/lib/rename/session.svelte');
    const { data } = await import('../src/lib/shared/state.svelte');
    data.profiles.rename.push({ id: 'p', name: 'P', desc: '', steps: [listStep], pair: false, destination: { mode: 'move', folder: 'D:\\out' }, conflict: 'skip' });
    // in the app $state wraps it in a proxy, which structuredClone rejects (tests run Svelte's server build, which doesn't)
    const p = data.profiles.rename[0];
    s.useProfile({ ...p, steps: new Proxy(p.steps, {}) });
    expect(s.session.rules).toEqual({ steps: [listStep], pair: false, destination: { mode: 'move', folder: 'D:\\out' }, conflict: 'skip' });
    expect(s.session.profileId).toBe('p');
  });
});

describe('rename Reset and edited', () => {
  const stored = { id: 'p', name: 'P', desc: '', steps: [listStep], pair: false, destination: { mode: 'move' as const, folder: 'D:\\out' }, conflict: 'skip' as const };
  /** Svelte wraps stored profiles in a proxy in the app, which structuredClone rejects (tests run the server build, which doesn't). */
  const use = async () => {
    const s = await import('../src/lib/rename/session.svelte');
    const { data } = await import('../src/lib/shared/state.svelte');
    m.listFiles.mockImplementation(async (p: string[]) => p.map(info));
    data.profiles.rename.push(structuredClone(stored));
    const p = data.profiles.rename[0];
    s.useProfile({ ...p, steps: new Proxy(p.steps, {}) });
    return s;
  };

  it('is edited once a rule differs from the loaded profile, and not before', async () => {
    const s = await import('../src/lib/rename/session.svelte');
    expect(s.edited.value).toBe(false); // no profile loaded
    const loaded = await use();
    expect(loaded.edited.value).toBe(false);
    loaded.session.rules.conflict = 'add';
    expect(loaded.edited.value).toBe(true);
    loaded.session.rules.conflict = 'skip';
    expect(loaded.edited.value).toBe(false);
    loaded.session.rules.steps.push({ type: 'trim' });
    expect(loaded.edited.value).toBe(true);
  });

  it('Reset restores the loaded profile, empties the file list and ends editing', async () => {
    const s = await use();
    await s.addPaths([A, B]);
    s.session.rules.pair = true;
    s.session.rules.steps = [];
    s.session.editing = true;
    s.reset();
    expect(s.session.rules).toEqual({ steps: [listStep], pair: false, destination: { mode: 'move', folder: 'D:\\out' }, conflict: 'skip' });
    expect(s.session.files).toEqual([]);
    expect(s.session.editing).toBe(false);
    expect(s.session.profileId).toBe('p');
    expect(s.edited.value).toBe(false);
  });

  it('Reset without a profile goes back to the defaults', async () => {
    const s = await import('../src/lib/rename/session.svelte');
    const { DEFAULT_RULES } = await import('../src/lib/rename/engine/profile');
    m.listFiles.mockImplementation(async (p: string[]) => p.map(info));
    await s.addPaths([A]);
    s.session.rules.conflict = 'replace';
    s.reset();
    expect(s.session.rules).toEqual(DEFAULT_RULES);
    expect(s.session.rules).not.toBe(DEFAULT_RULES);
    expect(s.session.files).toEqual([]);
  });

  it('Reset does nothing while a batch runs', async () => {
    const s = await load([listStep]);
    s.session.busy = true;
    s.session.editing = true;
    s.reset();
    expect(s.session.files).toHaveLength(2);
    expect(s.session.rules.steps).toEqual([listStep]);
    expect(s.session.editing).toBe(true);
  });

  it('the picker closes when its file leaves the list, not when another one does', async () => {
    const s = await load([listStep]);
    s.session.picking = A;
    s.removeFile(B);
    expect(s.session.picking).toBe(A);
    s.removeFile(A);
    expect(s.session.picking).toBeNull();
    await s.addPaths([A, B]);
    s.session.picking = B;
    s.clearFiles();
    expect(s.session.picking).toBeNull();
  });

  it('using a profile ends editing', async () => {
    const s = await use();
    s.session.editing = true;
    const { data } = await import('../src/lib/shared/state.svelte');
    const p = data.profiles.rename[0];
    s.useProfile({ ...p, steps: new Proxy(p.steps, {}) });
    expect(s.session.editing).toBe(false);
  });
});

