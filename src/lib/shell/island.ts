export type Notice = 'attention' | 'done' | 'update';
export type Layer = 'tools' | 'working' | Notice | 'restarting' | 'restored';

export type IslandState = {
  /** a running job: reading files, applying or undoing a batch */
  activity: { label: string; done: number; total: number; cancellable: boolean } | null;
  /** the last batch ("12 files renamed"); shown as the Undo chip */
  done: string | null;
  /** how many files need attention */
  attention: number;
  /** version of a downloaded update */
  update: string | null;
  transient: { kind: 'restarting' | 'restored'; text: string } | null;
  /** the notice shown full size; null = folded into chips */
  open: Notice | null;
};

export type IslandEvent =
  | { type: 'start'; label: string; total: number; cancellable: boolean }
  | { type: 'progress'; done: number; total: number }
  | { type: 'finish'; text: string | null; attention: number }
  | { type: 'stop' }
  | { type: 'collapse' }
  | { type: 'attention'; count: number }
  | { type: 'updateReady'; version: string }
  | { type: 'restarting' }
  | { type: 'restored'; text: string }
  | { type: 'clearTransient' };

export const INITIAL: IslandState = { activity: null, done: null, attention: 0, update: null, transient: null, open: null };

/** How long each layer stays before it folds (spec: done 4 s, attention 6 s, update 3.5 s). */
export const TIMEOUT_MS: Partial<Record<Layer, number>> = { done: 4000, attention: 6000, update: 3500, restored: 2200 };

export function reduce(s: IslandState, e: IslandEvent): IslandState {
  switch (e.type) {
    case 'start':
      return { ...s, activity: { label: e.label, done: 0, total: e.total, cancellable: e.cancellable }, open: null };
    case 'progress':
      return s.activity ? { ...s, activity: { ...s.activity, done: e.done, total: e.total } } : s;
    case 'finish':
      return { ...s, activity: null, done: e.text ?? s.done, attention: e.attention, open: e.attention ? 'attention' : e.text ? 'done' : null };
    case 'stop':
      return { ...s, activity: null };
    case 'collapse':
      return { ...s, open: null, transient: s.transient?.kind === 'restored' ? null : s.transient };
    case 'attention':
      return { ...s, attention: e.count, open: !e.count && s.open === 'attention' ? null : s.open };
    case 'updateReady':
      return { ...s, update: e.version, open: s.open ?? 'update' };
    case 'restarting':
      return { ...s, transient: { kind: 'restarting', text: 'Restarting…' } };
    case 'restored':
      return { ...s, done: null, open: null, transient: { kind: 'restored', text: e.text } };
    case 'clearTransient':
      return { ...s, transient: null };
  }
}

const has = (s: IslandState, n: Notice) => (n === 'attention' ? s.attention > 0 : n === 'done' ? !!s.done : !!s.update);

/** Priority: transient > working > attention > done > update (only one notice is open at a time). */
export function layer(s: IslandState): Layer {
  if (s.transient) return s.transient.kind;
  if (s.activity) return 'working';
  if (s.open && has(s, s.open)) return s.open;
  return 'tools';
}

export function chips(s: IslandState): Notice[] {
  return layer(s) === 'tools' ? (['attention', 'done', 'update'] as const).filter((n) => has(s, n)) : [];
}

export function noticeText(s: IslandState, n: Notice): string {
  if (n === 'attention') return `${s.attention} ${s.attention === 1 ? 'file needs' : 'files need'} attention`;
  return n === 'done' ? (s.done ?? '') : 'Update ready';
}

/** What the island says (also announced to screen readers). */
export function layerText(s: IslandState): string {
  const l = layer(s);
  if (l === 'working') {
    const a = s.activity!;
    return a.total ? `${a.label} ${Math.min(a.done + 1, a.total)} of ${a.total}` : `${a.label}…`;
  }
  if (l === 'restarting' || l === 'restored') return s.transient!.text;
  return l === 'tools' ? '' : noticeText(s, l);
}
