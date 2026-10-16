import { INITIAL, reduce, type IslandEvent } from './island';

export const island = $state({ ...INITIAL });

export function send(e: IslandEvent) {
  Object.assign(island, reduce($state.snapshot(island), e));
}

// dev only: lets scripts/cdp.mjs drive the island (`__send({ type: 'finish', text: '6 files renamed', attention: 0 })`)
if (import.meta.env.DEV) Object.assign(window, { __send: send });
