import { describe, expect, it } from 'vitest';
import { findValue } from '../src/lib/rename/engine/findValue';
import { classifyPdfError } from '../src/lib/rename/engine/pdfItems';
import { cases, expectParity, fixtureItems, golden } from './golden-helpers';

describe('parity with Nomina 1.4.6 (legacy build)', () => {
  it.each(Object.keys(golden))('%s', (file) => expectParity('legacy', file));
});

describe('fixtures', () => {
  it('golden covers every case and finds plenty of values', () => {
    expect(Object.keys(golden).sort()).toEqual(Object.keys(cases).sort());
    const values = Object.values(golden).flatMap((g) => Object.values(g));
    expect(values.filter((v) => v !== null).length).toBeGreaterThan(30);
  });

  it('known values come out as designed', async () => {
    const items = await fixtureItems('legacy', 'ssrs-same-line.pdf');
    expect(findValue(items, 'Invoice No.:', 'after')).toEqual({ ok: true, value: 'DN-2026-00017' });
    expect(findValue(items, 'Customer', 'below')).toEqual({ ok: true, value: 'Contoso Fake GmbH' });
  });

  it('occurrence 2 finds the second keyword', async () => {
    const items = await fixtureItems('legacy', 'ssrs-repeat.pdf');
    expect(findValue(items, 'Invoice No.:', 'after')).toEqual({ ok: true, value: 'CN-2026-00019' });
    expect(findValue(items, 'Invoice No.:', 'after', 2)).toEqual({ ok: true, value: 'DN-2026-00011' });
  });

  it('a scan reports no text layer', async () => {
    expect(findValue(await fixtureItems('legacy', 'scanned.pdf'), 'Invoice No.:', 'after')).toMatchObject({ ok: false, reason: 'no-text' });
  });

  it.each(['broken.pdf', 'empty.pdf'])('%s is reported as unreadable, not a crash', async (file) => {
    const err = await fixtureItems('legacy', file).then(() => null, (e: unknown) => e);
    expect(err).not.toBeNull();
    expect(classifyPdfError(err).reason).toBe('unreadable');
  });
});
