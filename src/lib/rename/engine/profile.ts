import type { Position, RenameProfile, Step } from '../../shared/types';

export const POSITIONS: Position[] = ['after', 'before', 'above', 'below'];

/** What the Rename screen edits: a profile without its id, name and description. */
export type RenameRules = Omit<RenameProfile, 'id' | 'name' | 'desc'>;

export const DEFAULT_RULES: RenameRules = {
  steps: [{ type: 'pdfValue', keyword: '', position: 'after', occurrence: 1 }],
  pair: true,
  destination: { mode: 'inplace' },
  conflict: 'add',
};

export function rulesFromProfile(p: RenameProfile): RenameRules {
  return { steps: structuredClone(p.steps), pair: p.pair, destination: { ...p.destination }, conflict: p.conflict };
}

/** A match number from a number input can be null, NaN or fractional: it is stored as a whole number, at least 1. */
export function matchNo(v: unknown): number {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 1 ? n : 1;
}

export function profileFromRules(r: RenameRules, name: string, id: string, desc = ''): RenameProfile {
  return { id, name, desc, steps: structuredClone(r.steps).map(healStep) as Step[], pair: r.pair, destination: { ...r.destination }, conflict: r.conflict };
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const isStr = (v: unknown) => typeof v === 'string';
const isBool = (v: unknown) => typeof v === 'boolean';
const isInt = (v: unknown) => Number.isInteger(v);
const oneOf = (all: readonly string[]) => (v: unknown) => all.includes(v as string);

type Shape = Record<string, (v: unknown) => boolean>;
const fits = (shape: Shape, v: unknown) => Object.entries(shape).every(([k, ok]) => ok(obj(v)[k]));
const AT = oneOf(['start', 'end']);
const INSERT: Shape = { text: isStr, at: isInt };

/** The field checks for each step kind. */
const SHAPES: Record<Step['type'], Shape> = {
  pdfValue: { keyword: isStr, position: oneOf(POSITIONS), occurrence: isInt },
  pdfPattern: { preset: oneOf(['invoice', 'date', 'custom', 'title', 'created']), regex: isStr, occurrence: isInt },
  list: { path: isStr, match: isStr, name: isStr, against: oneOf(['name', 'value']) },
  addText: { prefix: isStr, suffix: isStr, insert: (v) => v === undefined || fits(INSERT, v) },
  replace: { find: isStr, with: isStr, regex: isBool, matchCase: isBool, all: isBool },
  remove: { what: oneOf(['range', 'digits', 'between']), from: isInt, to: isInt, start: isStr, end: isStr },
  trim: {},
  case: { to: oneOf(['upper', 'lower', 'title', 'sentence']) },
  number: { start: isInt, step: isInt, pad: isInt, at: AT, sep: isStr },
  date: { from: oneOf(['today', 'modified', 'created']), format: isStr, at: AT, sep: isStr },
};

export function validStep(v: unknown): v is Step {
  const t = obj(v).type;
  return typeof t === 'string' && Object.hasOwn(SHAPES, t) && fits(SHAPES[t as Step['type']], v);
}

/** Stored match numbers that a number input once let through (null, 1.5) are healed rather than dropping the profile. */
function healStep(s: unknown) {
  const o = obj(s);
  return o.type === 'pdfValue' || o.type === 'pdfPattern' ? { ...o, occurrence: matchNo(o.occurrence) } : s;
}

/** One stored or imported profile: bad steps or a missing id or name drop it, missing options get defaults. */
export function renameProfile(v: unknown): RenameProfile | null {
  const p = obj(v);
  const [id, name] = [str(p.id), str(p.name)];
  const steps = Array.isArray(p.steps) ? p.steps.map(healStep) : null;
  if (!id || !name || !steps || !steps.every(validStep)) return null;
  const d = obj(p.destination);
  return {
    id,
    name,
    desc: str(p.desc),
    steps,
    pair: typeof p.pair === 'boolean' ? p.pair : true,
    destination: (d.mode === 'copy' || d.mode === 'move') && str(d.folder) ? { mode: d.mode, folder: str(d.folder) } : { mode: 'inplace' },
    conflict: p.conflict === 'skip' || p.conflict === 'replace' ? p.conflict : 'add',
  };
}
