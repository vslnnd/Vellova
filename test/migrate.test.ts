import { describe, expect, it } from 'vitest';
import { DEFAULT_SPLIT_RULES } from '../src/lib/split/engine/profile';
import { planSplitifyImport, SPLITIFY_FILES } from '../src/lib/migrate/splitify';
import { freshProfiles, importProfiles, isEmpty, mapHistory, mapProfiles, mapSettings, mergeImport, planImport } from '../src/lib/migrate/nomina';
import { DEFAULT_RULES, profileFromRules, renameProfile, validStep } from '../src/lib/rename/engine/profile';
import { NEW_STEP } from '../src/lib/rename/engine/steps';
import { normalizeProfiles } from '../src/lib/shared/store';

const PROFILES = [
  { id: 'p_1', name: 'Debit notes', keyword: 'Invoice No.:', position: 'below', prefix: 'CN_', suffix: '', description: 'monthly' },
  { id: 'p_2', name: 'Odd', keyword: 'Ref', position: 'sideways' },
  { nope: true },
];
const HISTORY = [
  {
    id: 'h_1', timestamp: '2026-10-01T08:00:00.000Z', profileName: 'Debit notes', totalRenamed: 2, outputDir: 'C:\\in',
    files: [{ name: 'DN-1.pdf', path: 'C:\\in\\DN-1.pdf' }, { name: 'DN-1.xlsx', path: 'C:\\in\\DN-1.xlsx' }],
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
    expect(h[1].items[0]).toEqual({ from: '', to: 'C:\\in\\DN-1.pdf', ok: true });
    expect(h[0].profile).toBeUndefined();
    expect(h[2].items).toEqual([{ from: 'scan.pdf', to: 'A.pdf', ok: true }]);
  });

  it('settings map theme and update checks', () => {
    expect(mapSettings(SETTINGS)).toEqual({ theme: 'light', updates: { onStartup: false, everyHours: 1 } });
    expect(mapSettings({ checkInterval: '6h' }).updates).toEqual({ onStartup: true, everyHours: 6 });
    expect(mapSettings({ checkInterval: 'daily' }).updates?.everyHours).toBe(24);
    expect(mapSettings({ theme: 'purple' })).toEqual({});
  });

  it('inherited property names are not update intervals', () => {
    for (const k of ['constructor', 'toString', '__proto__', 'weekly']) {
      expect(mapSettings({ checkInterval: k }).updates).toBeUndefined();
      expect(mapSettings({ checkOnStartup: true, checkInterval: k }).updates).toEqual({ onStartup: true, everyHours: 1 });
    }
  });

  it('hostile Vellova profile files drop bad profiles and fill defaults', () => {
    const good = { id: 'a', name: 'A', desc: '', steps: [{ type: 'pdfValue', keyword: 'K', position: 'after', occurrence: 1 }, { type: 'addText', prefix: '', suffix: '' }], pair: true, destination: { mode: 'inplace' }, conflict: 'add' };
    const hostile = [
      { ...good, id: 'b', steps: [null] },
      { ...good, id: 'c', steps: [{ type: 'run', keyword: 'x' }] },
      { ...good, id: 'd', steps: [{ type: 'pdfValue', keyword: 5, position: 'after', occurrence: 1 }] },
      { ...good, id: 'e', steps: [{ type: 'pdfValue', keyword: 'K', position: 'left', occurrence: 1 }] },
      { id: 'f', name: 'F', steps: [{ type: 'addText', prefix: 'x', suffix: '' }] },
      { ...good, id: 'g', pair: 'yes', destination: { mode: 'copy' }, conflict: 'nuke' },
    ];
    const out = importProfiles(JSON.stringify({ rename: [good, ...hostile] })).rename;
    expect(out.map((p) => p.id)).toEqual(['a', 'f', 'g']);
    expect(out[1]).toMatchObject({ desc: '', pair: true, destination: { mode: 'inplace' }, conflict: 'add' });
    expect(out[2]).toMatchObject({ pair: true, destination: { mode: 'inplace' }, conflict: 'add' });
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
    const split = { id: 's1', name: 'By city', desc: '', rules: { ...DEFAULT_SPLIT_RULES, column: 'City' }, archiveFolder: 'C:\\done' };
    expect(importProfiles(JSON.stringify({ rename: ours, split: [] }))).toEqual({ rename: ours, split: [] });
    expect(importProfiles(JSON.stringify({ rename: ours, split: [split, { nope: 1 }] }))).toEqual({ rename: ours, split: [split] });
    expect(importProfiles(JSON.stringify({ split: [split] }))).toEqual({ rename: [], split: [split] });
    expect(importProfiles(JSON.stringify(PROFILES)).rename.map((p) => p.name)).toEqual(['Debit notes', 'Odd']);
    expect(importProfiles(JSON.stringify(PROFILES)).split).toEqual([]);
    expect(importProfiles('not json')).toEqual({ rename: [], split: [] });
  });

  it('a Splitify array gives split profiles only, told apart by parameters or params', () => {
    const sp = [
      { id: 'a', name: 'Cities', description: 'd', parameters: [{ value: 7, label: 'Leeds', payable: false }, { value: 'x' }], archiveFolder: 'C:\\old' },
      { id: 'b', name: 'Legacy', params: [{ value: 'y', label: 5 }] },
    ];
    const out = importProfiles(JSON.stringify([...sp, { id: 3, name: 'Numeric', parameters: [] }, { id: 'c', parameters: [] }]));
    expect(out.rename).toEqual([]);
    expect(out.split.map((p) => [p.id, p.name, p.desc, p.archiveFolder, p.rules.mode])).toEqual([
      ['splitify-a', 'Cities', 'd', 'C:\\old', 'value'],
      ['splitify-b', 'Legacy', '', null, 'value'],
      ['splitify-3', 'Numeric', '', null, 'value'],
    ]);
    expect(out.split[0].rules.params).toEqual([{ value: '7', label: 'Leeds', payable: false }, { value: 'x', label: '', payable: true }]);
    expect(out.split[1].rules.params).toEqual([{ value: 'y', label: '', payable: true }]);
    expect(importProfiles('[]')).toEqual({ rename: [], split: [] });
  });
});

describe('freshProfiles', () => {
  it('drops ids already held and ids repeated within the import', () => {
    const p = (id: string) => ({ id, name: id });
    expect(freshProfiles(['a'], [p('a'), p('b'), p('b'), p('c')]).map((x) => x.id)).toEqual(['b', 'c']);
  });
});

describe('importing Splitify', () => {
  const profiles = JSON.stringify([
    { id: 'a', name: 'Cities', description: 'd', parameters: [{ value: 7, label: 'Leeds', payable: false }], archiveFolder: 'C:\\old' },
    { id: 'b', name: 'Legacy', params: [{ value: 'y' }] },
  ]);
  const history = JSON.stringify([
    { id: 'h1', timestamp: '2026-10-01T08:00:00.000Z', profileName: 'Cities', files: [{ name: 'a.xlsx', path: 'C:\\in\\a.xlsx' }], outputDir: 'C:\\out', totalCreated: 4 },
    { id: 'h2', timestamp: 1791000000000, profileName: '\u2014 no profile \u2014', files: [], outputDir: 'C:\\out', totalCreated: 0 },
    { id: 'h3', timestamp: 'nonsense', files: [] },
    'junk',
  ]);
  const fav = JSON.stringify(['C:\\a', 5, 'C:\\b', 'C:\\a']);
  const settings = JSON.stringify({ theme: 'light', checkUpdatesOnStartup: false, updateIntervalHours: 5, archiveOriginals: true });

  it('names the four files', () => {
    expect(SPLITIFY_FILES).toEqual(['Splitify\\splitify_profiles.json', 'Splitify\\splitify_history.json', 'Splitify\\splitify_favfolders.json', 'Splitify\\splitify_settings.json']);
  });

  it('maps profiles, history, favourites and settings', () => {
    const plan = planSplitifyImport([profiles, history, fav, settings]);
    expect(plan.profiles.map((p) => [p.id, p.rules.mode, p.rules.params])).toEqual([
      ['splitify-a', 'value', [{ value: '7', label: 'Leeds', payable: false }]],
      ['splitify-b', 'value', [{ value: 'y', label: '', payable: true }]],
    ]);
    expect(plan.history.map((b) => [b.id, b.tool, b.verb, b.summary, b.profile, b.undoable, b.rerun, b.items])).toEqual([
      ['splitify-h2', 'split', 'created', '0 files created', undefined, false, undefined, []],
      ['splitify-h1', 'split', 'created', '4 files created', 'Cities', false, undefined, [{ from: 'C:\\in\\a.xlsx', to: 'C:\\out', ok: true }]],
    ]);
    expect(plan.favourites).toEqual(['C:\\a', 'C:\\b']);
    expect(plan.settings).toEqual({ theme: 'light', updates: { onStartup: false, everyHours: 6 }, split: { archive: true } });
  });

  it('missing, malformed or wrong-shaped files import nothing', () => {
    const empty = { profiles: [], history: [], favourites: [], settings: {} };
    expect(planSplitifyImport([null, null, null, null])).toEqual(empty);
    expect(planSplitifyImport(['{oops', '{oops', '{oops', '{oops'])).toEqual(empty);
    expect(planSplitifyImport(['{}', '{}', '{}', '[]'])).toEqual(empty);
    expect(planSplitifyImport([null, null, null, JSON.stringify({ theme: 'blue', updateIntervalHours: 'x', archiveOriginals: 1 })]).settings).toEqual({});
  });

  it('maps update intervals to the nearest of 1, 6 and 24', () => {
    const hours = (n: number) => planSplitifyImport([null, null, null, JSON.stringify({ updateIntervalHours: n })]).settings.updates?.everyHours;
    expect([hours(1), hours(3), hours(4), hours(12), hours(16), hours(48)]).toEqual([1, 1, 6, 6, 24, 24]);
  });
});

describe('rename profiles with the new steps', () => {
  const profile = (steps: unknown[], id = 'p') => ({ id, name: 'P', desc: 'd', steps, pair: false, destination: { mode: 'copy', folder: 'C:\out' }, conflict: 'skip' });

  it('a 0.2.0 profile (value + add text) survives unchanged', () => {
    const old = profile([{ type: 'pdfValue', keyword: 'Invoice No.:', position: 'below', occurrence: 2 }, { type: 'addText', prefix: 'CN_', suffix: '' }]);
    expect(renameProfile(old)).toEqual(old);
  });

  it('every new step kind is valid with its defaults, and add text may carry an insert', () => {
    for (const step of Object.values(NEW_STEP)) expect(validStep(step)).toBe(true);
    expect(validStep({ type: 'addText', prefix: '', suffix: '', insert: { text: '!', at: 0 } })).toBe(true);
    expect(renameProfile(profile(Object.values(NEW_STEP)))?.steps).toEqual(Object.values(NEW_STEP));
  });

  it('a wrong-typed field in any step kind drops the profile', () => {
    const bad: unknown[] = [
      { ...NEW_STEP.pdfValue, keyword: 5 },
      { ...NEW_STEP.pdfValue, position: 'left' },
      { ...NEW_STEP.pdfPattern, preset: 'phone' },
      { ...NEW_STEP.pdfPattern, regex: null },
      { ...NEW_STEP.list, path: 3 },
      { ...NEW_STEP.list, against: 'row' },
      { ...NEW_STEP.addText, prefix: 1 },
      { ...NEW_STEP.addText, insert: { text: '!' } },
      { ...NEW_STEP.addText, insert: 'x' },
      { ...NEW_STEP.addText, insert: null },
      { ...NEW_STEP.replace, regex: 'yes' },
      { ...NEW_STEP.replace, all: 1 },
      { ...NEW_STEP.replace, with: undefined },
      { ...NEW_STEP.remove, what: 'tail' },
      { ...NEW_STEP.remove, from: '1' },
      { ...NEW_STEP.remove, end: 0 },
      { ...NEW_STEP.case, to: 'snake' },
      { ...NEW_STEP.number, pad: '3' },
      { ...NEW_STEP.number, at: 'middle' },
      { ...NEW_STEP.number, sep: null },
      { ...NEW_STEP.date, from: 'tomorrow' },
      { ...NEW_STEP.date, format: 7 },
      { type: 'constructor' },
      { type: 'toString' },
      { type: 'upper' },
      'trim',
      null,
    ];
    for (const step of bad) expect(renameProfile(profile([step])), JSON.stringify(step)).toBeNull();
    expect(renameProfile(profile([NEW_STEP.trim, bad[0]]))).toBeNull();
  });

  it('a stored match number that is null, fractional or below 1 is healed to a whole number, not dropped', () => {
    const occ = (steps: unknown[]) => renameProfile(profile(steps))?.steps.map((s) => ('occurrence' in s ? s.occurrence : null));
    const value = (occurrence: unknown) => ({ type: 'pdfValue', keyword: 'K', position: 'after', occurrence });
    expect(occ([value(1.5), value(null), value(0), value(-2), value('x'), value(3), value(2.9)])).toEqual([1, 1, 1, 1, 1, 3, 2]);
    expect(occ([{ ...NEW_STEP.pdfPattern, occurrence: 1.5 }, { ...NEW_STEP.pdfPattern, occurrence: null }])).toEqual([1, 1]);
    const out = normalizeProfiles({ rename: [profile([value(1.5)], 'a'), profile([value(null)], 'b')] });
    expect(out.rename.map((p) => [p.id, p.steps[0]])).toEqual([['a', value(1)], ['b', value(1)]]);
    expect(validStep(value(1.5))).toBe(false);
  });

  it('profileFromRules stores a whole match number, at least 1', () => {
    const occ = (occurrence: unknown) => profileFromRules({ ...DEFAULT_RULES, occurrence: occurrence as number }, 'P', 'p').steps[0];
    expect([occ(null), occ(NaN), occ(1.5), occ(0), occ(4)]).toEqual([1, 1, 1, 1, 4].map((occurrence) => ({ type: 'pdfValue', keyword: '', position: 'after', occurrence })));
    expect(validStep(occ(null))).toBe(true);
  });

  it('a missing id or name drops the profile; missing options get defaults', () => {
    expect(renameProfile({ ...profile([]), id: '' })).toBeNull();
    expect(renameProfile({ ...profile([]), name: undefined })).toBeNull();
    expect(renameProfile({ ...profile([]), steps: 'trim' })).toBeNull();
    expect(renameProfile(null)).toBeNull();
    expect(renameProfile({ id: 'a', name: 'A', steps: [] })).toEqual({ id: 'a', name: 'A', desc: '', steps: [], pair: true, destination: { mode: 'inplace' }, conflict: 'add' });
  });

  it('normalizeProfiles drops a broken rename profile and keeps the good ones', () => {
    const good = profile([NEW_STEP.trim], 'good');
    const out = normalizeProfiles({ rename: [good, profile([{ type: 'case', to: 'snake' }], 'bad'), 7, { name: 'no id', steps: [] }], split: [] });
    expect(out.rename).toEqual([good]);
    expect(normalizeProfiles({ rename: 'oops' }).rename).toEqual([]);
  });
});
