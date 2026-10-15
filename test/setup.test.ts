import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('project setup', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

  it('pins pdf.js to the exact version Nomina 1.4.6 used', () => {
    expect(pkg.dependencies['pdfjs-dist']).toBe('3.11.174');
  });

  it('loads nothing from the network at startup', () => {
    expect(readFileSync('index.html', 'utf8')).not.toMatch(/https?:\/\//);
  });
});
