import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { companionData } from '../src/lib/rename/engine/companion';
import { findValue } from '../src/lib/rename/engine/findValue';
import { pairCompanions } from '../src/lib/rename/engine/pairing';
import { FIRST_SAMPLE, NO_NUMBER, PAIRED, SAMPLE_COUNT, WITH_VALUE } from '../src/lib/tour/steps';
import { fixtureItems } from './golden-helpers';

const DIR = 'src-tauri/resources/tour';
const WANT: Record<string, string | null> = {
  'scan_0011.pdf': 'INV-2041',
  'scan_0012.pdf': 'INV-2042',
  'scan_0013.pdf': 'INV-2043',
  [NO_NUMBER]: null,
  'scan_0015.pdf': 'INV-2044',
};

describe('tour samples', () => {
  it('are exactly the set the tour expects', () => {
    expect(readdirSync(DIR).sort()).toEqual([...Object.keys(WANT), PAIRED].sort());
    expect(Object.keys(WANT).length + 1).toBe(SAMPLE_COUNT);
    expect(Object.values(WANT).filter(Boolean).length).toBe(WITH_VALUE);
    expect(WANT[FIRST_SAMPLE]).toBeTruthy();
  });

  it.each(Object.entries(WANT))('%s gives %s after "Invoice No.:"', async (file, want) => {
    const r = findValue(await fixtureItems('modern', file, DIR), 'Invoice No.:', 'after');
    expect(r.ok ? r.value : null).toBe(want);
  });

  it('the export pairs with the second invoice only', () => {
    const data = companionData('.xlsx', new Uint8Array(readFileSync(`${DIR}/${PAIRED}`)));
    const pdfs = [{ path: 'a', value: 'INV-2041' }, { path: 'b', value: 'INV-2042' }];
    expect(pairCompanions(pdfs, [{ path: 'x', data }])).toEqual({ x: 'b' });
  });
});
