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

/** Splitify items carry their values as `parameters` (or the older `params`); Nomina's profiles carry neither. */
export const isSplitifyProfiles = (text: string) => items(text).some((p) => 'parameters' in p || 'params' in p);

/** Splitify's profiles file → split profiles by value. The result goes through the profile validator. */
export function splitifyProfiles(text: string): SplitProfile[] {
  return items(text)
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
