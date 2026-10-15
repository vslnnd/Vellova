export type ThemePref = 'system' | 'dark' | 'light';

export function resolveTheme(pref: ThemePref, systemDark: boolean): 'dark' | 'light' {
  return pref === 'system' ? (systemDark ? 'dark' : 'light') : pref;
}

const systemQuery = () => matchMedia('(prefers-color-scheme: dark)');
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Sets `<html data-theme>`; returns the theme in effect. */
export function applyTheme(pref: ThemePref): 'dark' | 'light' {
  const theme = resolveTheme(pref, systemQuery().matches);
  document.documentElement.dataset.theme = theme;
  return theme;
}

export function watchSystemTheme(onChange: () => void) {
  systemQuery().addEventListener('change', onChange);
}

/** Animation length for Svelte transitions (they use the Web Animations API, which CSS can't silence). */
export const motion = (ms: number) => (reducedMotion() ? 0 : ms);

/** Runs `apply` (which must update the DOM synchronously) and reveals the new theme as a circle from `from`. */
export function switchTheme(apply: () => void, from?: HTMLElement) {
  if (!document.startViewTransition || reducedMotion() || !from) return apply();
  const r = from.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  const end = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  const vt = document.startViewTransition(apply);
  vt.ready
    .then(() =>
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${end}px at ${x}px ${y}px)`] },
        { duration: 560, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', pseudoElement: '::view-transition-new(root)' },
      ),
    )
    .catch(() => {});
}
