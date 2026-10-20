import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Parent, RootContent } from 'mdast';

/** Replaces every node under `parent`, depth first, with what `fn` returns for it. */
export function mapNodes(parent: Parent, fn: (node: RootContent) => RootContent): void {
  parent.children = parent.children.map((child) => {
    const next = fn(child);
    if ('children' in next) mapNodes(next, fn);
    return next;
  });
}

/** Example sources under `src/examples/`, keyed by file name without extension. */
export type Examples = Record<string, { source: string; lang: 'ts' | 'tsx' }>;

/** Reads every `.ts` and `.tsx` file in `dir` as {@link Examples}. */
export function readExamples(dir: string): Examples {
  const examples: Examples = {};
  for (const name of readdirSync(dir).filter((file) => /\.tsx?$/.test(file))) {
    const lang = name.endsWith('.tsx') ? 'tsx' : 'ts';
    examples[name.slice(0, -lang.length - 1)] = {
      source: readFileSync(join(dir, name), 'utf8'),
      lang,
    };
  }
  return examples;
}

/** The example `example`, or an error naming `where` (the page that asked for it). */
export function findExample(
  examples: Examples,
  example: string | undefined,
  where: string,
): Examples[string] {
  const file = example === undefined ? undefined : examples[example];
  if (!file) throw new Error(`${where}: unknown example "${example}"`);
  return file;
}

/** The `region` of `example` and its language, for a `::code` directive on page `where`. */
export function exampleCode(
  examples: Examples,
  example: string | undefined,
  region: string | undefined,
  where: string,
): { lang: 'ts' | 'tsx'; value: string } {
  const { source, lang } = findExample(examples, example, where);
  if (region === undefined)
    throw new Error(`${where}: ::code{example="${example}"} needs a region`);
  try {
    return { lang, value: extractRegion(source, region) };
  } catch (error) {
    // extractRegion knows neither the page nor the example; an author needs both.
    throw new Error(
      `${where}: example "${example}": ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

const REGION_START = /^\s*\/\/\s*#region\s+(\S+)\s*$/;
const REGION_END = /^\s*\/\/\s*#endregion\b/;

/**
 * The lines between each `// #region <name>` and its matching `// #endregion`, markers and
 * `// #hide` lines stripped, each block dedented, blocks joined by a blank line.
 */
export function extractRegion(source: string, name: string): string {
  const blocks: string[] = [];
  let body: string[] | undefined;
  let depth = 0;
  for (const line of source.split('\n')) {
    if (!body) {
      if (REGION_START.exec(line)?.[1] === name) {
        body = [];
        depth = 1;
      }
    } else if (REGION_START.test(line)) {
      depth += 1;
    } else if (REGION_END.test(line)) {
      depth -= 1;
      if (depth === 0) {
        blocks.push(dedent(body));
        body = undefined;
      }
    } else if (!line.trimEnd().endsWith('// #hide')) {
      body.push(line);
    }
  }
  if (body) throw new Error(`region "${name}" is not closed`);
  if (blocks.length === 0) throw new Error(`region "${name}" not found`);
  return blocks.join('\n\n');
}

function dedent(lines: string[]): string {
  const indents = lines
    .filter((line) => line.trim() !== '')
    .map((line) => line.length - line.trimStart().length);
  const cut = Math.min(...indents);
  return lines.map((line) => line.slice(cut)).join('\n');
}
