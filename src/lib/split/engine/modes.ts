import type { Param, Person } from '../../shared/types';

export type ValueGroup = { key: string; rows: number[]; values: string[] };
export type Assignment = { person: number[]; groups: number[]; warnings: string[] };

const EPS = 1e-9;
const norm = (s: string) => s.trim().toLowerCase();

export function byValue(cells: string[], params: Param[]) {
  const map = new Map<string, Param>();
  for (const p of params) map.set(norm(String(p.value)), p);
  const groups = new Map<string, ValueGroup>();
  const unmatched: number[] = [];
  const excluded: number[] = [];
  cells.forEach((cell, i) => {
    const p = map.get(norm(cell));
    if (!p) return void unmatched.push(i);
    if (!p.payable) return void excluded.push(i);
    const key = p.label.trim() || String(p.value);
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { key, rows: [], values: [] }));
    g.rows.push(i);
    if (!g.values.includes(String(p.value))) g.values.push(String(p.value));
  });
  const list = [...groups.values()];
  for (const g of list) g.values.sort();
  return { groups: list, unmatched, excluded };
}

function weights(people: Person[]): number[] {
  const w = people.map((p) => (Number.isFinite(p.weight) && p.weight > 0 ? p.weight : 0));
  return w.some((x) => x > 0) ? w : w.map(() => 1);
}

export function evenBlocks(n: number, people: Person[]): number[] {
  const w = weights(people);
  const total = w.reduce((a, b) => a + b, 0);
  const exact = w.map((x) => (x * n) / total);
  const sizes = exact.map((e) => Math.floor(e + EPS));
  let left = n - sizes.reduce((a, b) => a + b, 0);
  const order = exact.map((e, i) => ({ i, f: e - sizes[i] }))
    .sort((a, b) => (Math.abs(a.f - b.f) < EPS ? a.i - b.i : b.f - a.f));
  for (const { i } of order) {
    if (left-- <= 0) break;
    sizes[i]++;
  }
  return sizes;
}

export function keepGroups(keys: string[], people: Person[]): Assignment {
  if (!people.length) return { person: keys.map(() => -1), groups: [], warnings: [] };
  const w = weights(people);
  const total = w.reduce((a, b) => a + b, 0);
  const target = w.map((x) => (x * keys.length) / total);
  const assigned = people.map(() => 0);
  const byKey = new Map<string, number[]>();
  keys.forEach((k, i) => {
    const a = byKey.get(k);
    if (a) a.push(i);
    else byKey.set(k, [i]);
  });
  const order = [...byKey.entries()].map(([key, rows], first) => ({ key, rows, first }))
    .sort((a, b) => b.rows.length - a.rows.length || a.first - b.first);
  const person = new Array<number>(keys.length).fill(0);
  const groups = people.map(() => 0);
  const warnings: string[] = [];
  for (const g of order) {
    let best = 0;
    for (let i = 1; i < people.length; i++) {
      if (target[i] - assigned[i] > target[best] - assigned[best]) best = i;
    }
    if (g.rows.length > target[best] + EPS) {
      warnings.push(`"${g.key}" has ${g.rows.length} rows, more than ${people[best].name}'s share of ${Math.round(target[best])}.`);
    }
    for (const r of g.rows) person[r] = best;
    assigned[best] += g.rows.length;
    groups[best]++;
  }
  return { person, groups, warnings };
}

export function fixedRows(n: number, size: number): number[] {
  const s = Math.max(1, Math.floor(size));
  const out: number[] = [];
  for (let left = n; left > 0; left -= s) out.push(Math.min(s, left));
  return out;
}

export function equalParts(n: number, parts: number): number[] {
  const k = Math.min(Math.max(1, Math.floor(parts)), n);
  if (k <= 0) return [];
  return Array.from({ length: k }, (_, i) => Math.floor(n / k) + (i < n % k ? 1 : 0));
}
