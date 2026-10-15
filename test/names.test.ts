import { describe, expect, it } from 'vitest';
import { extOf, join, sanitize, splitExt, splitPath } from '../src/lib/shared/names';

describe('names', () => {
  it('splits Windows and forward-slash paths', () => {
    expect(splitPath('C:\\Docs\\in\\INV-1.pdf')).toEqual({ dir: 'C:\\Docs\\in', name: 'INV-1.pdf' });
    expect(splitPath('C:/Docs/in/INV-1.pdf')).toEqual({ dir: 'C:/Docs/in', name: 'INV-1.pdf' });
  });

  it('lower-cases extensions like 1.4.6 and keeps names without one', () => {
    expect(extOf('C:\\a\\Scan.PDF')).toBe('.pdf');
    expect(extOf('C:\\a\\README')).toBe('');
    expect(extOf('C:\\a.b\\file')).toBe('');
    expect(splitExt('report.final.XLSX')).toEqual({ base: 'report.final', ext: '.XLSX' });
    expect(splitExt('.hidden')).toEqual({ base: '.hidden', ext: '' });
  });

  it('joins with a single backslash', () => {
    expect(join('C:\\out', 'a.pdf')).toBe('C:\\out\\a.pdf');
    expect(join('C:\\out\\', 'a.pdf')).toBe('C:\\out\\a.pdf');
    expect(join('D:/', 'a.pdf')).toBe('D:/a.pdf');
  });

  it('sanitizes exactly like 1.4.6 for its characters', () => {
    expect(sanitize('INV/2026/17')).toBe('INV_2026_17');
    expect(sanitize('a\\b:c*d?e"f<g>h|i')).toBe('a_b_c_d_e_f_g_h_i');
    expect(sanitize('  DN-17  ')).toBe('DN-17');
  });

  it('also makes control characters and reserved device names safe', () => {
    expect(sanitize('DN\t17\u0001')).toBe('DN_17_');
    expect(sanitize('CON')).toBe('CON_');
    expect(sanitize('nul')).toBe('nul_');
    expect(sanitize('COM1')).toBe('COM1_');
    expect(sanitize('CON.backup')).toBe('CON_.backup');
    expect(sanitize('CONTOSO')).toBe('CONTOSO');
  });

  it('keeps a trailing dot when an extension follows (1.4.6 behaviour)', () => {
    expect(sanitize('No. 17.')).toBe('No. 17.');
  });
});
