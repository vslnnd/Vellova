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
    expect(step('preview').lost!({ ...base, values: 1 })).toMatch(/Invoice No/);
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
});

describe('tourProfile', () => {
  it('is the profile saved during the tour, never one that existed before', () => {
    expect(tourProfile(null, ['a'])).toBeNull();
    expect(tourProfile('a', ['a', 'b'])).toBeNull();
    expect(tourProfile('new', ['a', 'b'])).toBe('new');
  });
});

describe('withoutTour', () => {
  const b = (id: string) => ({ id }) as Batch;
  const p = (id: string) => ({ id }) as RenameProfile;
  it('removes only the tour batch and profile', () => {
    const r = withoutTour([b('t'), b('x')], [p('tp'), p('y')], { dir: 'd', batch: 't', profile: 'tp' });
    expect(r.history.map((h) => h.id)).toEqual(['x']);
    expect(r.profiles.map((h) => h.id)).toEqual(['y']);
  });
  it('removes nothing when the tour made nothing', () => {
    const r = withoutTour([b('x')], [p('y')], { dir: 'd', batch: null, profile: null });
    expect(r.history).toHaveLength(1);
    expect(r.profiles).toHaveLength(1);
  });
});
