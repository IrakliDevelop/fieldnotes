import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The packages the site documents, in display order. */
export const PUBLIC_PACKAGES = [
  '@fieldnotes/core',
  '@fieldnotes/react',
  '@fieldnotes/vue',
  '@fieldnotes/svelte',
  '@fieldnotes/sync',
  '@fieldnotes/sync-server',
  '@fieldnotes/sync-redis',
  '@fieldnotes/vtt',
] as const;

/** One of {@link PUBLIC_PACKAGES}. */
export type PublicPackage = (typeof PUBLIC_PACKAGES)[number];

/** The version each package installs as, and where it was read. */
export type InstallableVersions = Record<
  PublicPackage,
  { version: string; source: 'npm' | 'workspace' }
>;

interface RegistryOptions {
  fetch?: typeof fetch;
  strict?: boolean;
}

type VersionOptions = RegistryOptions & { workspaceVersion?: (pkg: PublicPackage) => string };

/** Absolute path of a repository file; walks up from this module so a bundled copy finds it too. */
export function repoFile(...segments: string[]): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(dir, 'pnpm-workspace.yaml'))) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error('repository root not found');
    dir = parent;
  }
  return join(dir, ...segments);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function versionOf(doc: unknown): string {
  if (!isRecord(doc) || typeof doc.version !== 'string') throw new Error('no version field');
  return doc.version;
}

function workspaceVersionOf(pkg: PublicPackage): string {
  const path = repoFile('packages', pkg.replace('@fieldnotes/', ''), 'package.json');
  return versionOf(JSON.parse(readFileSync(path, 'utf8')));
}

async function registryGet(fetchFn: typeof fetch, url: string): Promise<unknown> {
  const response = await fetchFn(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

const registryUrl = (pkg: PublicPackage) => `https://registry.npmjs.org/${pkg.replace('/', '%2F')}`;

const readFailure = (pkg: PublicPackage, error: unknown) =>
  new Error(
    `npm registry read failed for ${pkg}: ${error instanceof Error ? error.message : String(error)}`,
  );

const isStrict = () => process.env.FIELDNOTES_STRICT_VERSIONS === '1';

async function loadVersions({
  fetch: fetchFn = fetch,
  strict = isStrict(),
  workspaceVersion = workspaceVersionOf,
}: VersionOptions): Promise<InstallableVersions> {
  const unreachable: PublicPackage[] = [];
  const entries = await Promise.all(
    PUBLIC_PACKAGES.map(async (pkg) => {
      try {
        const version = versionOf(await registryGet(fetchFn, `${registryUrl(pkg)}/latest`));
        return [pkg, { version, source: 'npm' }] as const;
      } catch (error) {
        if (strict) throw readFailure(pkg, error);
        unreachable.push(pkg);
        return [pkg, { version: workspaceVersion(pkg), source: 'workspace' }] as const;
      }
    }),
  );
  if (unreachable.length > 0) {
    console.warn(
      `npm registry read failed for ${unreachable.join(', ')}; using workspace versions`,
    );
  }
  // Every key is present: the entries map PUBLIC_PACKAGES one to one.
  return Object.fromEntries(entries) as InstallableVersions;
}

let memo: Promise<InstallableVersions> | undefined;

/** Versions from the npm registry, or the workspace manifests when it can't be read and not strict. */
export function getInstallableVersions(opts: VersionOptions = {}): Promise<InstallableVersions> {
  if (opts.fetch) return loadVersions(opts);
  memo ??= loadVersions(opts);
  return memo;
}

/** Release day (`YYYY-MM-DD`) of each published version, from the registry `time` field. */
export async function getReleaseDates(
  pkg: PublicPackage,
  { fetch: fetchFn = fetch, strict = isStrict() }: RegistryOptions = {},
): Promise<Record<string, string>> {
  try {
    const doc = await registryGet(fetchFn, registryUrl(pkg));
    if (!isRecord(doc) || !isRecord(doc.time)) throw new Error('no time field');
    const dates: Record<string, string> = {};
    for (const [version, time] of Object.entries(doc.time)) {
      if (/^\d+\.\d+\.\d+/.test(version) && typeof time === 'string') {
        dates[version] = time.slice(0, 10);
      }
    }
    return dates;
  } catch (error) {
    if (strict) throw readFailure(pkg, error);
    console.warn(`${readFailure(pkg, error).message}; showing no release dates`);
    return {};
  }
}
