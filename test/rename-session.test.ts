import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Grid } from '../src/lib/split/engine/grid';
import type { FileInfo, Step } from '../src/lib/shared/types';

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
const grid: Grid = { sheets: [{ name: 'Sheet1', rows: 2 }], sheet: 'Sheet1', rows: [['File', 'Client'], ['a', 'Acme']], merges: [] };
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
});
