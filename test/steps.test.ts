import { describe, expect, it } from 'vitest';
import { counted, inSampleDir, STEPS, tourProfile, withoutTour, type TourView } from '../src/lib/tour/steps';
import type { Batch, RenameProfile } from '../src/lib/shared/types';

const base: TourView = { samples: 6, values: 4, reading: false, named: false, batch: null, busy: false, undone: false, profile: null, error: false };
const step = (id: string) => STEPS.find((s) => s.id === id)!;
const done = (id: string, v: Partial<TourView>) => {
  const d = step(id).done;
  return typeof d === 'function' && d({ ...base, ...v });
};

describe('tour steps', () => {
  it('counts 14 pointing steps between the Start and Done cards', () => {
    expect(STEPS[0].id).toBe('start');
    expect(STEPS.at(-1)!.id).toBe('done');
    expect(counted.length).toBe(14);
  });

  it('waits for all six samples, the found values and the finished read', () => {
    expect(done('drop', { samples: 5 })).toBe(false);
    expect(done('drop', { samples: 6 })).toBe(true);
    expect(done('keyword', { values: 3 })).toBe(false);
    expect(done('keyword', { reading: true })).toBe(false);
    expect(done('keyword', {})).toBe(true);
  });

  it('apply and undo finish only once nothing is running', () => {
    expect(done('apply', { batch: 'b', busy: true })).toBe(false);
    expect(done('apply', { batch: 'b' })).toBe(true);
    expect(done('undo', { undone: true, busy: true })).toBe(false);
    expect(done('undo', { undone: true })).toBe(true);
    expect(done('profile', { profile: 'p' })).toBe(true);
  });

  it('says what went missing before the batch, and nothing after it', () => {
    expect(step('keyword').lost!({ ...base, samples: 0 })).toMatch(/left the list/);
    expect(step('position').lost!({ ...base, values: 1 })).toMatch(/Pick After again/);
    expect(step('position').lost!({ ...base, samples: 0, values: 0 })).toMatch(/left the list/);
    // the keyword field is blocked from the position step on: no hint asks to retype it
    for (const id of ['position', 'preview', 'name', 'pair', 'apply']) expect(step(id).lost!({ ...base, values: 1 })).not.toMatch(/Invoice No/);
    expect(step('preview').lost!({ ...base, values: 1 })).toMatch(/Skip the tour/);
    expect(step('preview').lost!({ ...base, values: 1, reading: true })).toBeNull();
    expect(step('apply').lost!({ ...base, samples: 0, values: 0, batch: 'b' })).toBeNull();
  });
});

describe('inSampleDir', () => {
  const dir = 'C:\\Temp\\vellova-tour-17';
  it('accepts files directly in the sample folder, any case or slash', () => {
    expect(inSampleDir(dir, 'C:\\Temp\\vellova-tour-17\\scan_0011.pdf')).toBe(true);
    expect(inSampleDir(dir, 'c:/temp/VELLOVA-TOUR-17/scan_0011.pdf')).toBe(true);
  });
  it('refuses everything else', () => {
    expect(inSampleDir(dir, 'C:\\Users\\me\\Invoices\\real.pdf')).toBe(false);
    expect(inSampleDir(dir, 'C:\\Temp\\vellova-tour-170\\scan_0011.pdf')).toBe(false);
    expect(inSampleDir(dir, 'C:\\Temp\\vellova-tour-17\\sub\\x.pdf')).toBe(false);
    expect(inSampleDir('', 'C:\\x.pdf')).toBe(false);
  });
  it('requires the folder itself to be vellova-tour- plus a name', () => {
    expect(inSampleDir('C:\\Temp\\other', 'C:\\Temp\\other\\a.pdf')).toBe(false);
    expect(inSampleDir('C:\\Temp\\vellova-tour-12', 'C:\\Temp\\vellova-tour-12\\a.pdf')).toBe(true);
    expect(inSampleDir('C:\\Temp\\vellova-tour-', 'C:\\Temp\\vellova-tour-\\a.pdf')).toBe(false);
  });
});

describe('tourProfile', () => {
  it('is the profile saved during the tour, never one that existed before', () => {
    expect(tourProfile(null, ['a'])).toBeNull();
    expect(tourProfile('a', ['a', 'b'])).toBeNull();
    expect(tourProfile('new', ['a', 'b'])).toBe('new');
  });
});

describe('withoutTour', () => {
  const dir = 'C:\\Temp\\vellova-tour-1';
  const b = (id: string, ...from: string[]) => ({ id, items: from.map((f) => ({ from: f, to: f + '.new', ok: true })) }) as unknown as Batch;
  const p = (id: string) => ({ id }) as RenameProfile;
  const sample = (n: string) => `${dir}\\${n}`;
  it('forgets only batches whose files all lie in the sample folder, and the tour profile', () => {
    const r = withoutTour([b('t', sample('a.pdf'), sample('b.pdf')), b('x', 'C:\\Real\\a.pdf')], [p('tp'), p('y')], { dir, batch: 't', profile: 'tp' });
    expect(r.forget).toEqual(['t']);
    expect(r.profiles.map((h) => h.id)).toEqual(['y']);
  });
  it('does not trust the marker batch id: a real batch under that id stays', () => {
    const r = withoutTour([b('x', 'C:\\Real\\a.pdf'), b('mixed', sample('a.pdf'), 'C:\\Real\\b.pdf'), b('empty')], [], { dir, batch: 'x', profile: null });
    expect(r.forget).toEqual([]);
  });
  it('catches a sample batch the marker never recorded (a crash mid-Apply)', () => {
    expect(withoutTour([b('late', sample('a.pdf'))], [], { dir, batch: null, profile: null }).forget).toEqual(['late']);
  });
  it('removes nothing when the tour made nothing, or the marker has no folder', () => {
    const r = withoutTour([b('x', 'C:\\Real\\a.pdf')], [p('y')], { dir, batch: null, profile: null });
    expect(r.forget).toEqual([]);
    expect(r.profiles).toHaveLength(1);
    expect(withoutTour([b('t', sample('a.pdf'))], [], { dir: '', batch: 't', profile: null }).forget).toEqual([]);
  });
});
