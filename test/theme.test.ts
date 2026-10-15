import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { resolveTheme } from '../src/lib/shell/theme';

const css = readFileSync('src/app.css', 'utf8');
function tokens(theme: 'dark' | 'light'): Record<string, string> {
  const start = css.indexOf(`[data-theme='${theme}'] {`);
  const block = css.slice(start, css.indexOf('}', start));
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9A-Fa-f]{6})/g)].map((m) => [m[1], m[2]]));
}
const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

describe('theme', () => {
  it('follows the system unless a theme is chosen', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it.each(['dark', 'light'] as const)('%s tokens match the spec and keep text contrast >= 4.5', (theme) => {
    const t = tokens(theme);
    const spec = theme === 'dark'
      ? { bg: '#0F1115', surface: '#161920', text: '#E9ECF1', accent: '#7AA7FF', err: '#FF8A8A' }
      : { bg: '#F5F6F8', surface: '#FFFFFF', text: '#12151B', accent: '#1D5BD8', err: '#BF2A2A' };
    for (const [k, v] of Object.entries(spec)) expect(t[k], k).toBe(v);
    for (const fg of ['text', 'text2', 'text3', 'accent', 'ok', 'warn', 'err'])
      for (const bg of ['bg', 'chrome', 'surface', 'surface2'])
        expect(contrast(t[fg], t[bg]), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t['on-accent'], t.accent)).toBeGreaterThanOrEqual(4.5);
  });
});
