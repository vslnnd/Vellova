import { setTheme } from '../app.svelte';
import { ipc } from '../shared/ipc';
import { data, log, notLoaded, save } from '../shared/state.svelte';
import { withDefaults } from '../shared/store';
import { freshProfiles, isEmpty, mergeImport, NOMINA_FILES, planImport } from './nomina';
import { planSplitifyImport, SPLITIFY_FILES } from './splitify';

/** Both old apps' files in one read: Nomina's first, then Splitify's. */
async function readPlans() {
  const texts = await ipc.readLegacy([...NOMINA_FILES, ...SPLITIFY_FILES]);
  return { nomina: planImport(texts.slice(0, NOMINA_FILES.length)), splitify: planSplitifyImport(texts.slice(NOMINA_FILES.length)) };
}

const hasSplitify = (s: ReturnType<typeof planSplitifyImport>) =>
  !!(s.profiles.length || s.history.length || s.favourites.length || Object.keys(s.settings).length);

export const findOldData = async () => {
  const p = await readPlans();
  return !isEmpty(p.nomina) || hasSplitify(p.splitify);
};

/**
 * Imports profiles and history from the previous rename and split apps; their settings only on first launch.
 * A data file that failed to load this session is left alone and reported as not imported.
 */
export async function importOldData(withSettings: boolean): Promise<string> {
  const { nomina, splitify } = await readPlans();
  const skipped: string[] = [];
  const m = mergeImport(
    { profiles: data.profiles.rename, history: data.history },
    {
      ...nomina,
      profiles: notLoaded('profiles') ? [] : nomina.profiles,
      history: notLoaded('history') ? [] : [...nomina.history, ...splitify.history],
    },
  );
  const split = notLoaded('profiles') ? [] : freshProfiles(data.profiles.split.map((p) => p.id), splitify.profiles);
  if (notLoaded('profiles')) skipped.push('profiles');
  else {
    data.profiles.rename = m.profiles;
    data.profiles.split = [...data.profiles.split, ...split];
    save('profiles');
  }
  if (notLoaded('history')) skipped.push('history');
  else {
    data.history = m.history;
    save('history');
  }
  if (withSettings || splitify.favourites.length) {
    if (notLoaded('settings')) skipped.push('settings');
    else {
      const have = data.settings.split.favourites;
      const favourites = [...have, ...splitify.favourites.filter((f) => !have.includes(f))];
      // Splitify's settings win over the rename app's where both set a value.
      const { split: sp, ...rest } = withSettings ? { ...nomina.settings, ...splitify.settings } : ({} as typeof splitify.settings);
      data.settings = withDefaults({ ...data.settings, ...rest, split: { ...data.settings.split, ...sp, favourites } });
      setTheme(data.settings.theme);
      save('settings');
    }
  }
  const p = m.added.profiles + split.length;
  const h = m.added.history;
  const text =
    `Imported ${p} ${p === 1 ? 'profile' : 'profiles'} and ${h} history ${h === 1 ? 'entry' : 'entries'}.` +
    (skipped.length ? ` Not imported, because that saved data could not be loaded: ${skipped.join(', ')}.` : '');
  log({ level: 'info', tool: 'app', message: text });
  return text;
}
