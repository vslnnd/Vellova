import { ui } from '../app.svelte';
import { pathKey } from '../rename/engine/files';
import { DEFAULT_RULES, type RenameRules } from '../rename/engine/profile';
import { addPaths, clearFiles, session, setAddFilter, whenIdle } from '../rename/session.svelte';
import { undoBatch } from '../shared/batches';
import { ipc } from '../shared/ipc';
import { join } from '../shared/names';
import { data, log, save } from '../shared/state.svelte';
import type { TourMarker } from '../shared/types';
import { island, send } from '../shell/islandState.svelte';
import { session as splitSession } from '../split/session.svelte';
import { inSampleDir, NO_NUMBER, PAIRED, STEPS, tourProfile, withoutTour, type TourView } from './steps';

export const tour = $state({
  /** index in STEPS while the tour runs; -1 when it doesn't */
  step: -1,
  /** a card outside the steps */
  card: null as 'welcome' | 'resume' | null,
  /** this run's sample folder */
  dir: '',
  /** when the current step began (errors logged after it offer "Skip this step") */
  since: 0,
  /** why the samples couldn't be prepared */
  error: '',
  /** the Start card is copying the samples */
  preparing: false,
});

/** endTour is running (a second Skip waits for nothing) */
let ending = false;

/** What the Rename screen held before the tour, and which profiles already existed. */
let before: { rules: RenameRules; profileId: string | null; ids: string[] } | null = null;

export const tourActive = () => tour.step >= 0 || tour.card !== null;
export const current = () => (tour.step >= 0 ? STEPS[tour.step] : undefined);
/** The island keeps "done · Undo" open while the tour points at it. */
export const holdDone = () => current()?.id === 'undo';

const inDir = (path: string) => inSampleDir(tour.dir, path);

/** Marks the two sample rows the tour points at. */
export function tourRow(path: string): string | undefined {
  if (!tour.dir) return undefined;
  const k = pathKey(path);
  if (k === pathKey(join(tour.dir, NO_NUMBER))) return 'name-row';
  if (k === pathKey(join(tour.dir, PAIRED))) return 'pair-row';
  return undefined;
}

export function view(): TourView {
  const samples = session.files.filter((f) => inDir(f.path));
  const noNumber = samples.find((f) => tourRow(f.path) === 'name-row');
  const batch = session.batch;
  return {
    samples: samples.length,
    values: samples.filter((f) => session.names[f.path]?.ok).length,
    reading: session.loading || session.dirty,
    named: !!noNumber && !!session.overrides[noNumber.path]?.trim(),
    batch,
    busy: session.busy || !!island.activity,
    undone: !!batch && !!data.history.find((h) => h.id === batch)?.undone,
    profile: tourProfile(session.profileId, before?.ids ?? []),
    error: data.log.some((e) => e.t >= tour.since && e.level === 'error'),
  };
}

function go(i: number) {
  tour.step = i;
  tour.since = Date.now();
}

/** Opens the tour at its Start card. The Rename screen is cleared; what was on it comes back afterwards. */
export function startTour() {
  if (session.busy) return; // a real batch is renaming: the tour would clear its list and mark its batch as the tour's
  before = { rules: $state.snapshot(session.rules), profileId: session.profileId, ids: data.profiles.rename.map((p) => p.id) };
  clearFiles();
  setAddFilter(inDir); // tour.dir is '' until the samples exist, so every add is refused until then
  session.rules = structuredClone(DEFAULT_RULES);
  session.profileId = null;
  ui.panel = null;
  ui.tool = 'rename';
  tour.card = null;
  tour.error = '';
  go(0);
}

/** The Start card's button: copies the samples, then points at the drop zone. */
export async function beginSamples() {
  if (tour.preparing) return;
  tour.error = '';
  tour.preparing = true;
  let dir: string;
  try {
    dir = await ipc.tourPrepare();
  } catch (e) {
    tour.error = `The sample files couldn't be prepared: ${String(e).replace(/^[a-z]+: /, '')}`;
    return;
  } finally {
    tour.preparing = false;
  }
  if (tour.step !== 0) {
    // the tour ended while copying: this folder is nobody's
    ipc.tourCleanup(dir).catch(() => {});
    return;
  }
  tour.dir = dir;
  data.settings.tour = { dir: tour.dir, batch: null, profile: null };
  save('settings');
  next();
}

export const addSamples = () => addPaths([tour.dir]);

/** Undo while the tour runs: only the tour's own batch, never a real one. */
export const undoTour = async () => {
  if (session.batch) await undoBatch(session.batch);
};

/** Moves on. What the tour has made so far is written to the marker first. */
export function next() {
  const m = data.settings.tour;
  if (m) {
    m.batch = session.batch;
    m.profile = tourProfile(session.profileId, before?.ids ?? []);
    save('settings');
  }
  if (tour.step + 1 < STEPS.length) go(tour.step + 1);
  else void endTour();
}

/** Finish or Skip: everything the tour made goes, and the Rename screen is as it was. */
export async function endTour() {
  if (ending) return;
  ending = true;
  try {
    await finish();
  } finally {
    ending = false;
  }
}

async function finish() {
  await whenIdle(); // a sample batch still renaming would otherwise come back into History after the cleanup
  // bring the marker up to date first (clearFiles resets session.batch), so a batch or profile made since the last Next goes too
  const now = data.settings.tour;
  if (now) {
    now.batch = session.batch;
    now.profile = tourProfile(session.profileId, before?.ids ?? []);
    now.ended = true;
    save('settings');
  }
  tour.step = -1;
  tour.card = null;
  ui.panel = null;
  setAddFilter(null);
  clearFiles();
  if (before) {
    session.rules = before.rules;
    session.profileId = before.profileId;
    before = null;
  }
  tour.dir = '';
  send({ type: 'reset' });
  const m = data.settings.tour;
  if (m) await cleanUp(m);
}

/** Removes the tour's batch, journals, profile and sample folder. The marker stays until all of it is gone. */
async function cleanUp(m: TourMarker) {
  const left = withoutTour(data.history, data.profiles.rename, m);
  data.profiles.rename = left.profiles;
  save('profiles');
  try {
    // a History entry goes only once its journals are forgotten, so a failure is retried at the next start
    for (const id of left.forget) {
      await ipc.forgetBatch(id);
      data.history = data.history.filter((h) => h.id !== id);
    }
    if (m.dir) await ipc.tourCleanup(m.dir);
    data.settings.tour = null;
  } catch (e) {
    log({ level: 'warn', tool: 'app', message: 'The tour sample files could not all be removed. Vellova tries again at the next start.', detail: String(e) });
  }
  save('history');
  save('settings');
}

/** At start, after recovery: a tour that a closed app left behind is cleaned up, then offered again once (not after Finish or Skip). */
export async function tourOnStart() {
  const m = data.settings.tour;
  if (!m) return;
  const resume = !m.ended;
  await cleanUp(m);
  // files sent from Explorer are already on a screen: Resume would clear them
  if (resume && !data.settings.tour && !tourActive() && !session.files.length && !splitSession.files.length) tour.card = 'resume';
}

/** Files arrived from Explorer: the "Resume the tour?" card gives way to them. */
export function dismissResume() {
  if (tour.card === 'resume') tour.card = null;
}
