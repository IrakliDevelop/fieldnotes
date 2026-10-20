import { readFileSync } from 'node:fs';
import { parseRoadmap } from './roadmap';
import { getInstallableVersions, repoFile } from './versions';
import type { InstallableVersions } from './versions';

/** One `<dt>`/`<dd>` pair of a Facts block. */
export interface Fact {
  term: string;
  detail: string;
}

/** The landing facts row, and the docs Facts block with versions and the missing features. */
export interface Facts {
  landing: Fact[];
  docs: { facts: Fact[]; versions: InstallableVersions; notBuilt: string[] };
}

const TERMS = {
  licence: 'Licence',
  framework: 'Framework',
  multiplayer: 'Multiplayer',
  input: 'Input',
  browsers: 'Browsers',
} as const;

const readContent = (name: string) => readFileSync(repoFile('website', 'content', name), 'utf8');

/** Reads `facts.json`, `roadmap.md` and the installable versions. */
export async function getFacts(): Promise<Facts> {
  const json: Record<string, unknown> = JSON.parse(readContent('facts.json'));
  const fact = (key: keyof typeof TERMS): Fact => {
    const detail = json[key];
    if (typeof detail !== 'string') throw new Error(`facts.json: ${key} must be a string`);
    return { term: TERMS[key], detail };
  };
  const landing = [fact('licence'), fact('framework'), fact('multiplayer'), fact('input')];
  return {
    landing,
    docs: {
      facts: [...landing, fact('browsers')],
      versions: await getInstallableVersions(),
      notBuilt: parseRoadmap(readContent('roadmap.md')).notBuilt,
    },
  };
}
