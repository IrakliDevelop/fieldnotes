import { PUBLIC_PACKAGES } from './versions';
import type { PublicPackage } from './versions';

/** One package release from `CHANGELOG.md`. */
export interface Release {
  package: string;
  npmName?: PublicPackage;
  version: string;
  title?: string;
  tickets: string[];
  date?: string;
  bodyMarkdown: string;
}

// A first release may end in " (new)" instead of a title; the marker is dropped.
const RELEASE_H3 =
  /^### (Core|React|Vue|Svelte|Sync|Sync server|Sync Redis|VTT|`@fieldnotes\/[a-z-]+`) (\d+\.\d+\.\d+)(?: — (.+)| \(new\))?$/;
const DATED_H2 = /^## \[(.+)\] — (\d{4}-\d{2}-\d{2})$/;
const ENTRY = /^(?:(@fieldnotes\/[a-z-]+|react) )?(\d+\.\d+\.\d+)$/;
const TICKET = /^[A-Z]+-?\d+$/;

const DISPLAY_NAMES = new Map<PublicPackage, string>([
  ['@fieldnotes/core', 'Core'],
  ['@fieldnotes/react', 'React'],
  ['@fieldnotes/vue', 'Vue'],
  ['@fieldnotes/svelte', 'Svelte'],
  ['@fieldnotes/sync', 'Sync'],
  ['@fieldnotes/sync-server', 'Sync server'],
  ['@fieldnotes/sync-redis', 'Sync Redis'],
  ['@fieldnotes/vtt', 'VTT'],
]);

const NPM_NAMES = new Map<string, PublicPackage>([
  ...[...DISPLAY_NAMES].map(([npm, display]) => [display, npm] as const),
  ...PUBLIC_PACKAGES.map((name) => [name, name] as const),
]);

/** The package name a release heading shows: "React", not "@fieldnotes/react". */
export function displayName({
  package: pkg,
  npmName,
}: Pick<Release, 'package' | 'npmName'>): string {
  return (npmName && DISPLAY_NAMES.get(npmName)) ?? pkg;
}

/** "Released YYYY-MM-DD" or "Not published yet"; undefined when the npm dates could not be read. */
export function releaseStatus(
  { version, date }: Pick<Release, 'version' | 'date'>,
  npmDates: Readonly<Record<string, string>> | undefined,
): string | undefined {
  if (npmDates === undefined) return undefined;
  const day = npmDates[version] ?? date;
  return day === undefined ? 'Not published yet' : `Released ${day}`;
}

type Draft = Omit<Release, 'bodyMarkdown'> & { body: string[] };

const sameRelease = (a: Draft, pkg: string, version: string) =>
  (a.npmName ?? a.package) === (NPM_NAMES.get(pkg) ?? pkg) && a.version === version;

// Ticket ids come out of every parenthesised group; words sharing a group with them stay.
function splitTickets(raw: string | undefined): { title?: string; tickets: string[] } {
  const tickets: string[] = [];
  const title = raw?.replace(/\s*\(([^)]*)\)/g, (_group, inner: string) => {
    const parts = inner.split(/,\s*/);
    tickets.push(...parts.filter((part) => TICKET.test(part)));
    const words = parts.filter((part) => !TICKET.test(part));
    return words.length > 0 ? ` (${words.join(', ')})` : '';
  });
  return { title, tickets };
}

function entryDraft(entry: string, date: string | undefined, body: string[]): Draft {
  const match = ENTRY.exec(entry);
  if (!match) throw new Error(`CHANGELOG.md: unrecognised entry "${entry}"`);
  const [, name = 'Core', version = ''] = match;
  const pkg = name === 'react' ? 'React' : name;
  return { package: pkg, npmName: NPM_NAMES.get(pkg), version, tickets: [], date, body };
}

/** Parses `CHANGELOG.md` into releases in file order; see the website plan for the heading rules. */
export function parseChangelog(markdown: string): Release[] {
  const drafts: Draft[] = [];
  let inSection = false;
  let date: string | undefined;
  let entries: Draft[] = [];
  let body: string[] | undefined;
  for (const line of markdown.split('\n')) {
    if (line.startsWith('## ')) {
      const dated = DATED_H2.exec(line);
      const [, list, day] = dated ?? [];
      inSection = dated !== null || line === '## [Unreleased]';
      date = day;
      const preamble: string[] = [];
      entries = list?.split(', ').map((entry) => entryDraft(entry, day, preamble)) ?? [];
      drafts.push(...entries);
      body = entries.length > 0 ? preamble : undefined;
      continue;
    }
    const heading = inSection ? RELEASE_H3.exec(line) : null;
    if (!heading) {
      body?.push(line);
      continue;
    }
    const [, rawPackage = '', version = '', rawTitle] = heading;
    const pkg = rawPackage.replaceAll('`', '');
    const draft: Draft = {
      package: pkg,
      npmName: NPM_NAMES.get(pkg),
      version,
      ...splitTickets(rawTitle),
      date,
      body: [],
    };
    const entry = entries.find((e) => sameRelease(e, pkg, version));
    if (entry) drafts[drafts.indexOf(entry)] = draft;
    else drafts.push(draft);
    body = draft.body;
  }
  return drafts.map(({ body: lines, ...release }) => ({
    ...release,
    bodyMarkdown: lines.join('\n').trim(),
  }));
}
