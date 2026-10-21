import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { displayName, parseChangelog, releaseStatus } from './changelog';
import type { Release } from './changelog';

const fixture = readFileSync(new URL('./fixtures/changelog-1d5f34e.md', import.meta.url), 'utf8');
const releases = parseChangelog(fixture);

const find = (pkg: string, version: string): Release | undefined =>
  releases.find((r) => (r.npmName ?? r.package) === pkg && r.version === version);

describe('parseChangelog on CHANGELOG.md at 1d5f34e', () => {
  it('starts with Core 0.95.0 and its ticket', () => {
    expect(releases[0]).toMatchObject({
      package: 'Core',
      npmName: '@fieldnotes/core',
      version: '0.95.0',
      title: 'embedded boards',
      tickets: ['A11'],
    });
    expect(releases[0]?.date).toBeUndefined();
    expect(releases[0]?.bodyMarkdown).toMatch(/^\*\*Added\*\*\n\n- `ViewportOptions\.embedded`/);
  });

  it('parses a release heading with no title', () => {
    expect(find('@fieldnotes/sync-redis', '0.14.1')).toMatchObject({
      package: 'Sync Redis',
      title: undefined,
      tickets: [],
    });
  });

  it('gives every ticket of a heading with several', () => {
    expect(find('@fieldnotes/core', '0.91.0')).toMatchObject({
      title: "interactive surface, render slots, renderMode 'dom'",
      tickets: ['F4', 'F5', 'C20'],
    });
  });

  it('keeps words that share the parentheses with a ticket', () => {
    expect(find('@fieldnotes/sync', '0.27.0')).toMatchObject({
      title: 'sync hygiene (first slice)',
      tickets: ['F8'],
    });
  });

  it('reads the releases of a dated section with its date', () => {
    const start = releases.findIndex((r) => r.package === 'Core' && r.version === '0.91.0');

    expect(releases.slice(start, start + 3).map((r) => [r.package, r.version, r.date])).toEqual([
      ['Core', '0.91.0', '2026-10-18'],
      ['VTT', '0.14.0', '2026-10-18'],
      ['Core', '0.90.0', '2026-10-18'],
    ]);
    expect(find('@fieldnotes/vtt', '0.14.0')?.bodyMarkdown).toMatch(
      /^\*\*Added\*\*\n\n- `RemoteMeasureOverlayHost`/,
    );
  });

  it('treats other H3s as body text, never as releases', () => {
    expect(
      releases.some((r) => r.package.includes('purity') || r.title === 'Package versions'),
    ).toBe(false);
    expect(find('@fieldnotes/vtt', '0.12.0')?.bodyMarkdown).toContain('### Package versions');
  });

  it('reads a package-named dated H2', () => {
    expect(find('@fieldnotes/sync-redis', '0.11.0')).toMatchObject({
      package: '@fieldnotes/sync-redis',
      date: '2026-09-12',
      tickets: [],
    });
    expect(find('@fieldnotes/sync-redis', '0.11.0')?.bodyMarkdown).toMatch(
      /^### Fixed\n\n- Redis fog/,
    );
  });

  it('gives each package of a multi-package H2 the shared body', () => {
    const server = find('@fieldnotes/sync-server', '0.10.1');
    const redis = find('@fieldnotes/sync-redis', '0.3.2');

    expect(server?.date).toBe('2026-08-01');
    expect(redis?.date).toBe('2026-08-01');
    expect(server?.bodyMarkdown).toMatch(/^### Fixed\n\n- Durable mutation fan-out/);
    expect(redis?.bodyMarkdown).toBe(server?.bodyMarkdown);
  });

  it('reads a [react x.y.z] H2 as a React release', () => {
    expect(find('@fieldnotes/react', '0.7.0')).toMatchObject({
      package: 'React',
      date: '2026-06-25',
    });
  });

  it('gives a dated version its preamble and still reads the release H3s after it', () => {
    const core = find('@fieldnotes/core', '0.85.0');

    expect(core?.date).toBe('2026-09-21');
    expect(core?.bodyMarkdown).toMatch(/^### Core purity pass \(F6\)\n\n\*\*Breaking changes/);
    expect(core?.bodyMarkdown).not.toContain('VTT extraction');
    expect(find('@fieldnotes/vtt', '0.12.0')).toMatchObject({
      title: 'VTT extraction and purity pass',
      date: '2026-09-21',
    });
  });

  it('skips an undated H2 and its content', () => {
    expect(releases.some((r) => r.bodyMarkdown.includes('examples/live-play'))).toBe(false);
    expect(find('@fieldnotes/core', '0.53.0')?.bodyMarkdown).not.toContain('Examples');
  });

  it('reads a backticked package name in a release H3', () => {
    expect(find('@fieldnotes/react', '0.14.0')).toMatchObject({
      package: '@fieldnotes/react',
      date: '2026-10-18',
    });
    expect(find('@fieldnotes/react', '0.14.0')?.bodyMarkdown).toContain('### Docs');
  });

  it('gives every release a version and no package-version pair twice', () => {
    const keys = releases.map((r) => `${r.npmName ?? r.package} ${r.version}`);

    expect(releases.every((r) => /^\d+\.\d+\.\d+$/.test(r.version))).toBe(true);
    expect(new Set(keys).size).toBe(keys.length);
    expect(releases.every((r) => r.npmName !== undefined)).toBe(true);
  });
});

describe('parseChangelog', () => {
  it('skips H3s under [Unreleased] before the first release', () => {
    const releases = parseChangelog(
      '## [Unreleased]\n\n### Website — new site\n\nNotes.\n\n### Core 0.97.0 — selection colour (A2)\n\nBody.\n',
    );

    expect(releases).toEqual([
      {
        package: 'Core',
        npmName: '@fieldnotes/core',
        version: '0.97.0',
        title: 'selection colour',
        tickets: ['A2'],
        bodyMarkdown: 'Body.',
      },
    ]);
  });

  it('skips release-shaped H3s under an undated H2', () => {
    expect(parseChangelog('## Examples\n\n### Core 1.0.0 — not a release\n\nText.\n')).toEqual([]);
  });

  it('throws on an entry it cannot read in a dated H2', () => {
    expect(() => parseChangelog('## [website 1.0.0] — 2026-10-20\n')).toThrow(
      'CHANGELOG.md: unrecognised entry "website 1.0.0"',
    );
  });
});

describe('parseChangelog on the current CHANGELOG.md', () => {
  const current = parseChangelog(
    readFileSync(new URL('../../../CHANGELOG.md', import.meta.url), 'utf8'),
  );
  const release = (npmName: string, version: string): Release | undefined =>
    current.find((r) => r.npmName === npmName && r.version === version);

  it.each([
    ['@fieldnotes/core', '0.97.0', 'selection colour', ['A2']],
    ['@fieldnotes/core', '0.96.0', 'viewport sources', ['A12']],
    ['@fieldnotes/react', '0.14.1', undefined, []],
    ['@fieldnotes/vue', '0.1.0', undefined, []],
    ['@fieldnotes/svelte', '0.1.0', undefined, []],
    ['@fieldnotes/angular', '0.1.0', undefined, []],
    ['@fieldnotes/core', '0.95.0', 'embedded boards', ['A11']],
  ])('reads %s %s with its title and tickets', (npmName, version, title, tickets) => {
    expect(release(npmName, version)).toMatchObject({ npmName, version, title, tickets });
  });

  it('lists each package version once', () => {
    const keys = current.map((r) => `${r.npmName ?? r.package}@${r.version}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('keeps the Vue and Svelte notes out of the React 0.14.1 body', () => {
    const react = release('@fieldnotes/react', '0.14.1');
    const vue = release('@fieldnotes/vue', '0.1.0');
    const svelte = release('@fieldnotes/svelte', '0.1.0');

    expect(react?.bodyMarkdown).not.toContain('@fieldnotes/vue');
    expect(react?.bodyMarkdown).not.toContain('@fieldnotes/svelte');
    expect(vue?.bodyMarkdown).toMatch(/^\*\*Added\*\*\n\n- `@fieldnotes\/vue`, Vue bindings/);
    expect(svelte?.bodyMarkdown).toMatch(
      /^\*\*Added\*\*\n\n- `@fieldnotes\/svelte`, Svelte bindings/,
    );
    expect(svelte?.bodyMarkdown).not.toContain('### Core');
  });

  it('reads the Angular 0.1.0 body without the Tooling notes', () => {
    const angular = release('@fieldnotes/angular', '0.1.0');

    expect(angular?.bodyMarkdown).toMatch(/^\*\*Added\*\*/);
    expect(angular?.bodyMarkdown).not.toContain('Node');
  });
});

describe('displayName', () => {
  it.each([
    ['Core', '@fieldnotes/core', 'Core'],
    ['@fieldnotes/react', '@fieldnotes/react', 'React'],
    ['@fieldnotes/sync-server', '@fieldnotes/sync-server', 'Sync server'],
    ['@fieldnotes/sync-redis', '@fieldnotes/sync-redis', 'Sync Redis'],
    ['@fieldnotes/vtt', '@fieldnotes/vtt', 'VTT'],
    ['Vue', '@fieldnotes/vue', 'Vue'],
    ['Angular', '@fieldnotes/angular', 'Angular'],
    ['@fieldnotes/other', undefined, '@fieldnotes/other'],
  ] as const)('names %s (%s) %s', (pkg, npmName, expected) => {
    expect(displayName({ package: pkg, npmName })).toBe(expected);
  });
});

describe('releaseStatus', () => {
  const npm = { '0.96.0': '2026-10-20' };

  it.each([
    ['a version npm dates', { version: '0.96.0' }, npm, 'Released 2026-10-20'],
    [
      'a dated version npm lacks',
      { version: '0.91.0', date: '2026-10-18' },
      npm,
      'Released 2026-10-18',
    ],
    ['an undated version npm lacks', { version: '0.97.0' }, npm, 'Not published yet'],
    ['any version when the read failed', { version: '0.97.0' }, undefined, undefined],
    [
      'a dated version when the read failed',
      { version: '0.91.0', date: '2026-10-18' },
      undefined,
      undefined,
    ],
  ])('gives %s', (_case, release, dates, expected) => {
    expect(releaseStatus(release, dates)).toBe(expected);
  });
});
