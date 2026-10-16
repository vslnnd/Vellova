import { setTheme } from '../app.svelte';
import { ipc } from '../shared/ipc';
import { data, log, notLoaded, save } from '../shared/state.svelte';
import { withDefaults } from '../shared/store';
import { isEmpty, mergeImport, NOMINA_FILES, planImport } from './nomina';

const readPlan = async () => planImport(await ipc.readLegacy(NOMINA_FILES));

export const findOldData = async () => !isEmpty(await readPlan());

/**
 * Imports profiles and history from the previous rename app; its settings only on first launch.
 * A data file that failed to load this session is left alone and reported as not imported.
 */
export async function importOldData(withSettings: boolean): Promise<string> {
  const plan = await readPlan();
  const skipped: string[] = [];
  const m = mergeImport(
    { profiles: data.profiles.rename, history: data.history },
    { ...plan, profiles: notLoaded('profiles') ? [] : plan.profiles, history: notLoaded('history') ? [] : plan.history },
  );
  if (notLoaded('profiles')) skipped.push('profiles');
  else {
    data.profiles.rename = m.profiles;
    save('profiles');
  }
  if (notLoaded('history')) skipped.push('history');
  else {
    data.history = m.history;
    save('history');
  }
  if (withSettings) {
    if (notLoaded('settings')) skipped.push('settings');
    else {
      data.settings = withDefaults({ ...data.settings, ...plan.settings });
      setTheme(data.settings.theme);
      save('settings');
    }
  }
  const { profiles: p, history: h } = m.added;
  const text =
    `Imported ${p} ${p === 1 ? 'profile' : 'profiles'} and ${h} history ${h === 1 ? 'entry' : 'entries'}.` +
    (skipped.length ? ` Not imported, because that saved data could not be loaded: ${skipped.join(', ')}.` : '');
  log({ level: 'info', tool: 'app', message: text });
  return text;
}
