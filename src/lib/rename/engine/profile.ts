import type { Conflict, Destination, Position, RenameProfile, Step } from '../../shared/types';

export const POSITIONS: Position[] = ['after', 'before', 'above', 'below'];

type ValueStep = Extract<Step, { type: 'pdfValue' }>;
type TextStep = Extract<Step, { type: 'addText' }>;

/** What the Rename screen edits; a profile stores the same as steps. */
export type RenameRules = {
  keyword: string;
  position: Position;
  occurrence: number;
  prefix: string;
  suffix: string;
  pair: boolean;
  destination: Destination;
  conflict: Conflict;
};

export const DEFAULT_RULES: RenameRules = {
  keyword: '',
  position: 'after',
  occurrence: 1,
  prefix: '',
  suffix: '',
  pair: true,
  destination: { mode: 'inplace' },
  conflict: 'add',
};

export function rulesFromProfile(p: RenameProfile): RenameRules {
  const value = p.steps.find((s): s is ValueStep => s.type === 'pdfValue');
  const text = p.steps.find((s): s is TextStep => s.type === 'addText');
  return {
    keyword: value?.keyword ?? '',
    position: value?.position ?? 'after',
    occurrence: value?.occurrence ?? 1,
    prefix: text?.prefix ?? '',
    suffix: text?.suffix ?? '',
    pair: p.pair,
    destination: { ...p.destination },
    conflict: p.conflict,
  };
}

export function profileFromRules(r: RenameRules, name: string, id: string, desc = ''): RenameProfile {
  return {
    id,
    name,
    desc,
    steps: [
      { type: 'pdfValue', keyword: r.keyword, position: r.position, occurrence: r.occurrence },
      { type: 'addText', prefix: r.prefix, suffix: r.suffix },
    ],
    pair: r.pair,
    destination: { ...r.destination },
    conflict: r.conflict,
  };
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

/** One stored or imported profile: bad steps or a missing id or name drop it, missing options get defaults. */
export function renameProfile(v: unknown): RenameProfile | null {
  const p = obj(v);
  const [id, name] = [str(p.id), str(p.name)];
  if (!id || !name || !Array.isArray(p.steps) || !p.steps.every(validStep)) return null;
  const d = obj(p.destination);
  return {
    id,
    name,
    desc: str(p.desc),
    steps: p.steps,
    pair: typeof p.pair === 'boolean' ? p.pair : true,
    destination: d.mode === 'copy' && str(d.folder) ? { mode: 'copy', folder: str(d.folder) } : { mode: 'inplace' },
    conflict: p.conflict === 'skip' || p.conflict === 'replace' ? p.conflict : 'add',
  };
}
