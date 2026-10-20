import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getInstallableVersions, getReleaseDates } from './versions';

const rejecting = (() => Promise.reject(new Error('offline'))) as typeof fetch;
const workspace = () => '0.0.1';

function registry(body: unknown, status = 200): typeof fetch {
  return vi.fn(async () => Response.json(body, { status })) as typeof fetch;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('getInstallableVersions', () => {
  it('reads each package from its npm latest document', async () => {
    const fetch = vi.fn(async (url: string | URL | Request) =>
      Response.json({ version: String(url).includes('%2Fvtt/') ? '0.16.0' : '1.2.3' }),
    );

    const versions = await getInstallableVersions({ fetch: fetch as typeof globalThis.fetch });

    expect(versions['@fieldnotes/core']).toEqual({ version: '1.2.3', source: 'npm' });
    expect(versions['@fieldnotes/vtt']).toEqual({ version: '0.16.0', source: 'npm' });
    expect(fetch).toHaveBeenCalledWith(
      'https://registry.npmjs.org/@fieldnotes%2Fsync-redis/latest',
    );
    expect(Object.keys(versions)).toEqual([
      '@fieldnotes/core',
      '@fieldnotes/react',
      '@fieldnotes/vue',
      '@fieldnotes/svelte',
      '@fieldnotes/sync',
      '@fieldnotes/sync-server',
      '@fieldnotes/sync-redis',
      '@fieldnotes/vtt',
    ]);
  });

  it('falls back to workspace versions with one warning when the registry is unreachable', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const versions = await getInstallableVersions({
      fetch: rejecting,
      strict: false,
      workspaceVersion: workspace,
    });

    expect(versions['@fieldnotes/sync-server']).toEqual({ version: '0.0.1', source: 'workspace' });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('falls back on a non-ok registry response', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const versions = await getInstallableVersions({
      fetch: registry({ error: 'not found' }, 404),
      strict: false,
      workspaceVersion: workspace,
    });

    expect(versions['@fieldnotes/react'].source).toBe('workspace');
  });

  it('defaults the fallback to packages/<name>/package.json', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const manifest: { version: string } = JSON.parse(
      readFileSync(new URL('../../../packages/core/package.json', import.meta.url), 'utf8'),
    );

    const versions = await getInstallableVersions({ fetch: rejecting, strict: false });

    expect(versions['@fieldnotes/core']).toEqual({
      version: manifest.version,
      source: 'workspace',
    });
  });

  it('throws naming the package when strict', async () => {
    await expect(
      getInstallableVersions({
        fetch: registry({ version: 42 }),
        strict: true,
        workspaceVersion: workspace,
      }),
    ).rejects.toThrow(/^npm registry read failed for @fieldnotes\/core: /);
  });

  it('is strict when FIELDNOTES_STRICT_VERSIONS is 1', async () => {
    vi.stubEnv('FIELDNOTES_STRICT_VERSIONS', '1');

    await expect(
      getInstallableVersions({ fetch: rejecting, workspaceVersion: workspace }),
    ).rejects.toThrow('npm registry read failed for @fieldnotes/core: offline');
  });
});

describe('getReleaseDates', () => {
  it('maps each version in the registry time field to its day', async () => {
    const fetch = registry({
      time: {
        created: '2026-03-01T10:00:00.000Z',
        modified: '2026-10-20T09:00:00.000Z',
        '0.1.0': '2026-03-08T12:30:00.000Z',
        '0.95.0': '2026-10-20T08:00:00.000Z',
      },
    });

    const dates = await getReleaseDates('@fieldnotes/core', { fetch });

    expect(dates).toEqual({ '0.1.0': '2026-03-08', '0.95.0': '2026-10-20' });
    expect(fetch).toHaveBeenCalledWith('https://registry.npmjs.org/@fieldnotes%2Fcore');
  });

  it('returns no dates with one warning when not strict', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(await getReleaseDates('@fieldnotes/vtt', { fetch: rejecting, strict: false })).toEqual(
      {},
    );
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('throws naming the package when strict', async () => {
    await expect(
      getReleaseDates('@fieldnotes/sync', { fetch: registry({}), strict: true }),
    ).rejects.toThrow(/^npm registry read failed for @fieldnotes\/sync: /);
  });
});
