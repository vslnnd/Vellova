import { invoke } from '@tauri-apps/api/core';

export const ipc = {
  dataRead: (name: string) => invoke<string | null>('data_read', { name }),
  dataWrite: (name: string, text: string) => invoke<void>('data_write', { name, text }),
  dataRename: (from: string, to: string) => invoke<void>('data_rename', { from, to }),
  readLegacy: (files: string[]) => invoke<(string | null)[]>('read_legacy', { files }),
  saveText: (path: string, text: string) => invoke<void>('save_text', { path, text }),
};
