import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn(), rename: vi.fn() }));
vi.mock('../src/lib/shared/ipc', () => ({
  ipc: {
    dataRead: (n: string) => m.read(n),
    dataWrite: (n: string, t: string) => m.write(n, t),
    dataRename: (a: string, b: string) => m.rename(a, b),
  },
}));

const files: Record<string, string> = {};
const written = () => m.write.mock.calls.map((c) => c[0] as string);

beforeEach(() => {
  vi.resetModules();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  for (const k of Object.keys(files)) delete files[k];
  m.read.mockReset().mockImplementation(async (n: string) => files[n] ?? null);
  m.write.mockReset().mockResolvedValue(undefined);
  m.rename.mockReset().mockResolvedValue(undefined);
});

const load = () => import('../src/lib/shared/state.svelte');

describe('loadAll', () => {
  it('keeps loading the other files when one cannot be read, and never overwrites it', async () => {
    files['profiles.json'] = '{"rename":[{"id":"p1"}],"split":[]}';
    files['history.json'] = '[{"id":"b1"}]';
    m.read.mockImplementation(async (n: string) => {
      if (n === 'settings.json') throw new Error('locked');
      return files[n] ?? null;
    });
    const s = await load();
    await s.loadAll();
    expect(s.data.profiles.rename).toHaveLength(1);
    expect(s.data.history).toHaveLength(1);
    expect(s.data.loaded).toBe(true);
    expect(s.data.log.some((e) => e.level === 'error' && e.message.includes('settings.json'))).toBe(true);

    s.save('settings');
    s.save('profiles');
    await s.flush();
    expect(written()).toContain('profiles.json');
    expect(written()).not.toContain('settings.json');
  });

  it('does not overwrite a file that could not be set aside', async () => {
    files['history.json'] = 'not json';
    m.rename.mockRejectedValue(new Error('antivirus lock'));
    const s = await load();
    await s.loadAll();
    expect(s.data.history).toEqual([]);
    s.save('history');
    await s.flush();
    expect(written()).not.toContain('history.json');
  });

  it('does not replace the log when it could not be read', async () => {
    files['log.jsonl'] = '{"t":1,"level":"info","tool":"app","message":"old"}';
    m.read.mockImplementation(async (n: string) => {
      if (n === 'log.jsonl') throw new Error('locked');
      return files[n] ?? null;
    });
    const s = await load();
    await s.loadAll();
    s.log({ level: 'info', tool: 'app', message: 'new' });
    await s.flush();
    expect(written()).not.toContain('log.jsonl');
  });
});

describe('save', () => {
  it('records a failed save in the log', async () => {
    const s = await load();
    await s.loadAll();
    m.write.mockRejectedValue(new Error('disk full'));
    s.save('settings');
    await s.flush();
    expect(s.data.log.at(-1)).toMatchObject({ level: 'error', tool: 'app', message: 'Could not save settings.json', detail: 'Error: disk full' });
    await s.flush();
    expect(written()).toContain('log.jsonl');
  });
});
