import { DEFAULT_SPLIT_RULES, splitProfile } from '../split/engine/profile';
import { isObj } from '../shared/store';
import type { SplitProfile } from '../shared/types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const items = (text: string): Record<string, any>[] => {
  try {
    const v = JSON.parse(text);
    return Array.isArray(v) ? v.filter(isObj) : [];
  } catch {
    return [];
  }
};

/** The parsed items when the text is Splitify's profiles file (they carry `parameters`, or the older `params`; Nomina's carry neither), else null. */
export const splitifyItems = (text: string) => {
  const all = items(text);
  return all.some((p) => 'parameters' in p || 'params' in p) ? all : null;
};

/** Splitify's profiles items → split profiles by value. The result goes through the profile validator. */
export function profilesOf(all: ReturnType<typeof items>): SplitProfile[] {
  return all
    .map((p) =>
      splitProfile({
        id: typeof p.id === 'string' || typeof p.id === 'number' ? `splitify-${p.id}` : undefined,
        name: p.name,
        desc: p.description,
        archiveFolder: p.archiveFolder,
        rules: { ...DEFAULT_SPLIT_RULES, mode: 'value', params: p.parameters ?? p.params },
      }),
    )
    .filter((p): p is SplitProfile => !!p);
}

export const splitifyProfiles = (text: string) => profilesOf(items(text));
