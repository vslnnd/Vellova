export function splitPath(p: string): { dir: string; name: string } {
  const i = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'));
  return { dir: p.slice(0, Math.max(i, 0)), name: p.slice(i + 1) };
}

export function splitExt(name: string): { base: string; ext: string } {
  const i = name.lastIndexOf('.');
  return i > 0 ? { base: name.slice(0, i), ext: name.slice(i) } : { base: name, ext: '' };
}

/** Lower-cased extension with its dot ("" if none), as Nomina 1.4.6 computed it. */
export const extOf = (p: string) => splitExt(splitPath(p).name).ext.toLowerCase();

export function join(dir: string, name: string): string {
  return /[\\/]$/.test(dir) ? dir + name : `${dir}\\${name}`;
}

const ILLEGAL = /[\\/:*?"<>|\x00-\x1f]/g;
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/**
 * Makes a base name safe for Windows. Nomina 1.4.6 replaced `\ / : * ? " < > |` with `_` and trimmed;
 * control characters and reserved device names (CON, NUL, COM1…) are handled too, because they fail on Windows.
 */
export function sanitize(base: string): string {
  const s = base.replace(ILLEGAL, '_').trim();
  return s.replace(RESERVED, '$1_$2');
}

/**
 * A folder template with `{value}`, `{n}` and `{date}` filled in. Each filled-in part is made safe on its own
 * (`\ /` inside it become `_`) and loses its trailing dots and spaces, which Windows drops from a folder name.
 * A part left empty becomes `_`, so a value can never name `.` or `..` and leave the chosen folder.
 * The template's own text stays as typed.
 */
export function expandFolder(template: string, n: { value: string | null; n: string; date: string }): string {
  return template.replace(/\{(value|n|date)\}/g, (_, k: 'value' | 'n' | 'date') => {
    return sanitize(n[k] ?? '').replace(/[. ]+$/, '') || '_';
  });
}
