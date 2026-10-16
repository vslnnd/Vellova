import { describe, expect, it } from 'vitest';
import { shortcut } from '../src/lib/shell/shortcuts';

const key = (k: string, mods: Partial<{ ctrlKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) => ({
  key: k, ctrlKey: false, shiftKey: false, altKey: false, ...mods,
});

describe('shortcuts', () => {
  it('Ctrl+1 / Ctrl+2 switch tools, Esc closes panels', () => {
    expect(shortcut(key('1', { ctrlKey: true }), false)).toBe('tool-rename');
    expect(shortcut(key('2', { ctrlKey: true }), true)).toBe('tool-split');
    expect(shortcut(key('Escape'), true)).toBe('close-panel');
  });

  it('Ctrl+Z undoes only outside text fields', () => {
    expect(shortcut(key('z', { ctrlKey: true }), false)).toBe('undo');
    expect(shortcut(key('Z', { ctrlKey: true }), false)).toBe('undo');
    expect(shortcut(key('z', { ctrlKey: true }), true)).toBeNull();
  });

  it('ignores other keys and modifier mixes', () => {
    expect(shortcut(key('1'), false)).toBeNull();
    expect(shortcut(key('z', { ctrlKey: true, shiftKey: true }), false)).toBeNull();
    expect(shortcut(key('1', { ctrlKey: true, altKey: true }), false)).toBeNull();
  });
});
