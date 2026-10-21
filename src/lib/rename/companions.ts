import { callSheetWorker } from '../split/sheets';
import type { CompanionData } from './engine/companion';

/** Reads a companion file (.xlsx/.csv/.xml/.txt) in the sheet worker. */
export const readCompanion = (ext: string, bytes: Uint8Array): Promise<CompanionData> =>
  callSheetWorker({ op: 'companion', ext, bytes });
