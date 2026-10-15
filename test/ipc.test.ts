import { describe, expect, it } from 'vitest';
import { ipcReason } from '../src/lib/shared/ipc';

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
