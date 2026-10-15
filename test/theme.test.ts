import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { resolveTheme } from '../src/lib/shell/theme';

const css = readFileSync('src/app.css', 'utf8');
function block(theme: 'dark' | 'light'): string {
  const start = css.indexOf(`[data-theme='${theme}'] {`);
  return css.slice(start, css.indexOf('}', start));
}
function tokens(theme: 'dark' | 'light'): Record<string, string> {
  return Object.fromEntries([...block(theme).matchAll(/--([\w-]+):\s*(#[0-9A-Fa-f]{6})/g)].map((m) => [m[1], m[2]]));
}
function tints(theme: 'dark' | 'light'): Record<string, number[]> {
  return Object.fromEntries(
    [...block(theme).matchAll(/--([\w-]+):\s*rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/g)].map((m) => [m[1], m.slice(2).map(Number)]),
  );
}
/** An rgba tint composited over an opaque hex colour, as a hex colour. */
const over = (base: string, [r, g, b, a]: number[]) =>
  '#' + [r, g, b].map((c, i) => Math.round(c * a + parseInt(base.slice(1 + i * 2, 3 + i * 2), 16) * (1 - a)).toString(16).padStart(2, '0')).join('');
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

  it.each(['dark', 'light'] as const)('%s pills keep text contrast >= 4.5 on their tint over every surface', (theme) => {
    const t = tokens(theme);
    const tint = tints(theme);
    for (const kind of ['ok', 'warn', 'err']) {
      const m = css.match(new RegExp(`\\.pill\\.${kind} \\{ color: var\\(--(\\w+)\\); background: var\\(--(\\w+)\\)`));
      expect(m, `.pill.${kind} rule`).not.toBeNull();
      const [, fg, soft] = m!;
      expect(soft, `.pill.${kind} uses its own tint`).toBe(`${kind}soft`);
      expect(tint[soft], `--${soft} is an rgba token`).toBeDefined();
      for (const bg of ['bg', 'chrome', 'surface', 'surface2'])
        expect(contrast(t[fg], over(t[bg], tint[soft])), `.pill.${kind} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
