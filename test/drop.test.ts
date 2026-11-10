import { describe, expect, it } from 'vitest';
import { dropTool } from '../src/lib/shell/drop';

describe('dropTool', () => {
  it('with zones, the left half is Rename and the right half is Split, whichever tool is on screen', () => {
    expect(dropTool(100, 900, 'split', true)).toBe('rename');
    expect(dropTool(449, 900, 'split', true)).toBe('rename');
    expect(dropTool(450, 900, 'rename', true)).toBe('split');
  });

  it('without zones, files join the list on screen', () => {
    expect(dropTool(800, 900, 'rename', false)).toBe('rename');
    expect(dropTool(10, 900, 'split', false)).toBe('split');
  });
});
