import type { Conflict, Destination, Position, RenameProfile, Step } from '../../shared/types';

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
