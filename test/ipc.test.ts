import { describe, expect, it, vi } from 'vitest';
import { ipc, ipcReason } from '../src/lib/shared/ipc';

const invoke = vi.hoisted(() => vi.fn(async (..._a: unknown[]) => {}));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

describe('saveBytes', () => {
  it('sends the bytes raw, with the path percent-encoded so any file name fits in a header', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    await ipc.saveBytes('C:\\Users\\Zoë\\日本語\\r.xlsx', bytes);
    const [cmd, body, opts] = invoke.mock.calls[0] as unknown as [string, Uint8Array, { headers: { path: string } }];
    expect([cmd, body]).toEqual(['save_bytes', bytes]);
    expect(opts.headers.path).toBe('C%3A%5CUsers%5CZo%C3%AB%5C%E6%97%A5%E6%9C%AC%E8%AA%9E%5Cr.xlsx');
  });
});

describe('ipcReason', () => {
  it('reads the reason code Rust puts in front of the message', () => {
    expect(ipcReason('locked: The process cannot access the file (os error 32)')).toEqual({
      reason: 'locked', detail: 'The process cannot access the file (os error 32)',
    });
    expect(ipcReason('missing: not found')).toEqual({ reason: 'missing', detail: 'not found' });
  });

  it('treats anything else as unreadable', () => {
    expect(ipcReason('internal: weird')).toEqual({ reason: 'unreadable', detail: 'internal: weird' });
    expect(ipcReason(new Error('boom'))).toEqual({ reason: 'unreadable', detail: 'Error: boom' });
  });
});
