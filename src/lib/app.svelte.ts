import { applyTheme, type ThemePref } from './shell/theme';

export type Tool = 'rename' | 'split';
export type PanelName = 'history' | 'profiles' | 'settings' | 'attention';

export const PANEL_TITLES: Record<PanelName, string> = {
  history: 'History',
  profiles: 'Profiles',
  settings: 'Settings',
  attention: 'Needs attention',};

export const ui = $state({ tool: 'rename' as Tool, panel: null as PanelName | null, dark: true });

export function setTheme(pref: ThemePref) {
  ui.dark = applyTheme(pref) === 'dark';
}
