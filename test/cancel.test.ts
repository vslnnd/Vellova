import { describe, expect, it } from 'vitest';
import { cancelTarget } from '../src/lib/shell/cancel';

const idle = { busy: false, loading: false };
describe('cancelTarget', () => {
  it('sends Cancel to the busy session whatever is on screen', () => {
    expect(cancelTarget({ busy: true, loading: false }, idle, 'rename')).toBe('split');
    expect(cancelTarget(idle, { busy: true, loading: false }, 'split')).toBe('rename');
  });
  it('a batch wins over a read in the other tool', () => {
    expect(cancelTarget({ busy: false, loading: true }, { busy: true, loading: false }, 'split')).toBe('rename');
  });
  it('then the one reading', () => {
    expect(cancelTarget({ busy: false, loading: true }, idle, 'rename')).toBe('split');
    expect(cancelTarget(idle, { busy: false, loading: true }, 'split')).toBe('rename');
  });
  it('else the tool on screen', () => {
    expect(cancelTarget(idle, idle, 'split')).toBe('split');
    expect(cancelTarget({ busy: false, loading: true }, { busy: false, loading: true }, 'rename')).toBe('rename');
  });
});
