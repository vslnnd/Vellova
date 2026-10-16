import { relaunch } from '@tauri-apps/plugin-process';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { data, flush, log } from './shared/state.svelte';
import { send } from './shell/islandState.svelte';

let ready: Update | null = null;
let timer: ReturnType<typeof setInterval> | undefined;
let inFlight: Promise<string> | null = null;

/** Looks for a newer release; one is downloaded in the background, then the island offers Restart. */
export function checkForUpdate(manual = false): Promise<string> {
  // A check already running (e.g. the scheduled one mid-download) is shared, not repeated.
  inFlight ??= runCheck().finally(() => (inFlight = null));
  return inFlight.then((text) => (text || !manual ? text : "Couldn't reach the update server. Are you online?"));
}

async function runCheck(): Promise<string> {
  if (ready) return `Version ${ready.version} is ready. Restart to install it.`;
  try {
    const update = await check();
    if (!update) return 'Vellova is up to date.';
    await update.download();
    ready = update;
    send({ type: 'updateReady', version: update.version });
    return `Version ${update.version} is ready. Restart to install it.`;
  } catch (e) {
    // spec: update-check failures are logged at info level and retried at the next interval
    log({ level: 'info', tool: 'app', message: 'Checking for updates failed; will try again later.', detail: String(e) });
    return '';
  }
}

/** Starts (or restarts, after a settings change) the periodic check. */
export function scheduleUpdates(startup: boolean) {
  clearInterval(timer);
  if (!import.meta.env.PROD) return;
  const { onStartup, everyHours } = data.settings.updates;
  if (startup && onStartup) void checkForUpdate();
  if (everyHours > 0) timer = setInterval(() => void checkForUpdate(), everyHours * 3_600_000);
}

/** Saves pending data, installs the downloaded update (the installer closes the app) and relaunches. */
export async function restartToUpdate() {
  if (!ready) return;
  send({ type: 'restarting' });
  try {
    await flush();
    await ready.install();
    await relaunch();
  } catch (e) {
    log({ level: 'error', tool: 'app', message: 'The update could not be installed.', detail: String(e) });
    send({ type: 'clearTransient' });
  }
}
