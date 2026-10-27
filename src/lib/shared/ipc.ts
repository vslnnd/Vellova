import { invoke } from '@tauri-apps/api/core';
import type { FileInfo, Op, Reason } from './types';

export type OpResult = { i: number; ok: boolean; code?: Reason | 'cancelled'; message?: string };
export type UndoReport = { restored: number; skipped: { path: string; reason: string }[] };

export const ipc = {
  dataRead: (name: string) => invoke<string | null>('data_read', { name }),
  dataWrite: (name: string, text: string) => invoke<void>('data_write', { name, text }),
  dataRename: (from: string, to: string) => invoke<void>('data_rename', { from, to }),
  readLegacy: (files: string[]) => invoke<(string | null)[]>('read_legacy', { files }),
  saveText: (path: string, text: string) => invoke<void>('save_text', { path, text }),
  /** Raw body; the path travels in a header, so it is percent-encoded (Rust decodes it). */
  saveBytes: (path: string, bytes: Uint8Array) => invoke<void>('save_bytes', bytes, { headers: { path: encodeURIComponent(path) } }),
  readFile: async (path: string) => new Uint8Array(await invoke<ArrayBuffer>('read_file', { path })),
  listFiles: (paths: string[], recursive: boolean) => invoke<FileInfo[]>('list_files', { paths, recursive }),
  listDir: (dirs: string[]) => invoke<string[]>('list_dir', { dirs }),
  applyPlan: (batch: string, ops: Op[]) => invoke<OpResult[]>('apply_plan', { batch, ops }),
  undoBatch: (batch: string) => invoke<UndoReport>('undo_batch', { batch }),
  cancelApply: () => invoke<void>('cancel_apply'),
  recoverAll: () => invoke<UndoReport>('recover_all'),
  forgetBatch: (batch: string) => invoke<void>('forget_batch', { batch }),
  stageWrite: (batch: string, n: number, bytes: Uint8Array) =>
    invoke<string>('stage_write', bytes, { headers: { batch, n: String(n) } }),
  stageClear: (batch: string) => invoke<void>('stage_clear', { batch }),
  foldersExist: (paths: string[]) => invoke<boolean[]>('folders_exist', { paths }),
  tourPrepare: () => invoke<string>('tour_prepare'),
  tourCleanup: (dir: string) => invoke<void>('tour_cleanup', { dir }),
};

const FILE_REASONS: Reason[] = ['missing', 'permission', 'locked'];

/** Turns a `read_file` rejection ("locked: …") into a reason for the preview. */
export function ipcReason(e: unknown): { reason: Reason; detail: string } {
  const msg = String(e);
  const code = msg.slice(0, msg.indexOf(':')) as Reason;
  return FILE_REASONS.includes(code) ? { reason: code, detail: msg.slice(code.length + 1).trim() } : { reason: 'unreadable', detail: msg };
}
