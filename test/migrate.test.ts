import { describe, expect, it } from 'vitest';
import { importProfiles, isEmpty, mapHistory, mapProfiles, mapSettings, mergeImport, planImport } from '../src/lib/migrate/nomina';

const PROFILES = [
  { id: 'p_1', name: 'Debit notes', keyword: 'Invoice No.:', position: 'below', prefix: 'CN_', suffix: '', description: 'monthly' },
  { id: 'p_2', name: 'Odd', keyword: 'Ref', position: 'sideways' },
  { nope: true },
];
const HISTORY = [
  {
    id: 'h_1', timestamp: '2026-10-01T08:00:00.000Z', profileName: 'Debit notes', totalRenamed: 2, outputDir: 'C:\in',
    files: [{ name: 'DN-1.pdf', path: 'C:\in\DN-1.pdf' }, { name: 'DN-1.xlsx', path: 'C:\in\DN-1.xlsx' }],
  },
  { id: 'h_2', timestamp: '2026-10-02T08:00:00.000Z', profileName: '—', files: [], totalRenamed: 0 },
];
const OLD_HISTORY = [{ id: 1700000000000, timestamp: 1700000000000, anchorText: 'No.', totalRenamed: 1, files: [{ newName: 'A.pdf', originalName: 'scan.pdf' }] }];
const SETTINGS = { theme: 'light', checkOnStartup: false, checkInterval: '30min' };

describe('importing the previous rename app', () => {
  it('profiles become one value step plus add text, with pairing on', () => {
    const [a, b, ...rest] = mapProfiles(PROFILES);
    expect(rest).toEqual([]);
    expect(a).toEqual({
      id: 'nomina-p_1', name: 'Debit notes', desc: 'monthly',
      steps: [{ type: 'pdfValue', keyword: 'Invoice No.:', position: 'below', occurrence: 1 }, { type: 'addText', prefix: 'CN_', suffix: '' }],
      pair: true, destination: { mode: 'inplace' }, conflict: 'add',
    });
    expect(b.steps[0]).toEqual({ type: 'pdfValue', keyword: 'Ref', position: 'after', occurrence: 1 });
  });

  it('both history files become read-only batches, newest first', () => {
    const h = mapHistory(HISTORY, OLD_HISTORY);
    expect(h.map((b) => [b.id, b.summary, b.undoable])).toEqual([
      ['nomina-h_2', '0 files renamed', false],
      ['nomina-h_1', '2 files renamed', false],
      ['nomina-old-1700000000000', '1 file renamed', false],
    ]);
    expect(h[1]).toMatchObject({ tool: 'rename', profile: 'Debit notes', time: Date.parse('2026-10-01T08:00:00.000Z') });
    expect(h[1].items[0]).toEqual({ from: '', to: 'C:\in\DN-1.pdf', ok: true });
    expect(h[0].profile).toBeUndefined();
    expect(h[2].items).toEqual([{ from: 'scan.pdf', to: 'A.pdf', ok: true }]);
  });

  it('settings map theme and update checks', () => {
    expect(mapSettings(SETTINGS)).toEqual({ theme: 'light', updates: { onStartup: false, everyHours: 1 } });
    expect(mapSettings({ checkInterval: '6h' }).updates).toEqual({ onStartup: true, everyHours: 6 });
    expect(mapSettings({ checkInterval: 'daily' }).updates?.everyHours).toBe(24);
    expect(mapSettings({ theme: 'purple' })).toEqual({});
  });

  it('missing or corrupt files import nothing', () => {
    expect(isEmpty(planImport([null, null, null, null]))).toBe(true);
    expect(isEmpty(planImport(['{oops', 'null', '', '[]']))).toBe(true);
    const plan = planImport([JSON.stringify(PROFILES), JSON.stringify(HISTORY), JSON.stringify(OLD_HISTORY), JSON.stringify(SETTINGS)]);
    expect([plan.profiles.length, plan.history.length, plan.settings.theme]).toEqual([2, 3, 'light']);
  });

  it('importing twice adds nothing the second time', () => {
    const plan = planImport([JSON.stringify(PROFILES), JSON.stringify(HISTORY), null, null]);
    const once = mergeImport({ profiles: [], history: [] }, plan);
    expect(once.added).toEqual({ profiles: 2, history: 2 });
    const twice = mergeImport({ profiles: once.profiles, history: once.history }, plan);
    expect(twice.added).toEqual({ profiles: 0, history: 0 });
    expect(twice.profiles).toHaveLength(2);
  });

  it('profile files: Vellova exports pass through, old files are mapped', () => {
    const ours = mapProfiles(PROFILES);
    expect(importProfiles(JSON.stringify({ rename: ours, split: [] }))).toEqual(ours);
    expect(importProfiles(JSON.stringify(PROFILES)).map((p) => p.name)).toEqual(['Debit notes', 'Odd']);
    expect(importProfiles('not json')).toEqual([]);
  });
});
