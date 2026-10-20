// Per-file ratchet for visual patterns the site's visual rules forbid. Counts may only go down.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { readSourceFiles, websiteRoot } from './lib/design-source.mjs';

const SITE_FONTS = ['young serif', 'public sans', 'kalam', 'jetbrains mono'];
const GENERIC_FONTS = [
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'inherit',
];
const ALLOWED_FONTS = new Set([...SITE_FONTS, ...GENERIC_FONTS]);
const EM_VALUE = /^-?(?:\d+\.?\d*|\.\d+)em$/;

const regexCount = (regex) => (text) => text.match(regex)?.length ?? 0;

// A value ends at `;`, `}` or a newline, or at the `"` closing an inline style attribute.
const declarationValues = (property, text) =>
  [...text.matchAll(new RegExp(`${property}:\\s*((?:"[^"\\n]*"|[^;{}"\\n])+)`, 'g'))].map((match) =>
    (match[1] ?? '').replace(/!important/, '').trim(),
  );

const isAllowedLetterSpacing = (value) =>
  value === 'normal' || value === '0' || (EM_VALUE.test(value) && parseFloat(value) <= 0.02);

const PATTERNS = [
  { id: 'gradient', count: regexCount(/(?:linear|radial|conic)-gradient/g) },
  { id: 'backdrop-filter', count: regexCount(/backdrop-filter/g) },
  { id: 'uppercase', count: regexCount(/text-transform:\s*uppercase/g) },
  { id: 'box-shadow', count: regexCount(/box-shadow:(?!\s*none\b)/g) },
  {
    id: 'letter-spacing',
    count: (text) =>
      declarationValues('letter-spacing', text).filter((value) => !isAllowedLetterSpacing(value))
        .length,
  },
  // Text symbols like © and ↔ are Extended_Pictographic too; only emoji-presented ones count.
  { id: 'emoji', count: regexCount(/\p{Emoji_Presentation}|\p{Extended_Pictographic}\uFE0F/gu) },
  {
    id: 'font-family',
    count: (text) =>
      declarationValues('font-family', text)
        .flatMap((value) => value.split(','))
        .map((name) =>
          name
            .trim()
            .replace(/^['"]|['"]$/g, '')
            .toLowerCase(),
        )
        .filter((name) => !ALLOWED_FONTS.has(name)).length,
  },
];

// The static ruled pictures of the hero and the docs board placeholder draw their lines with a gradient.
const ALLOWLIST = {
  gradient: ['src/components/Hero.astro', 'src/styles/board-placeholder.css'],
};

/** Counts each pattern per file as `{ [patternId]: { [file]: count } }`, skipping allow-listed files. */
export function collectCounts(files) {
  const counts = {};
  for (const { path: file, text } of files) {
    for (const pattern of PATTERNS) {
      if (ALLOWLIST[pattern.id]?.includes(file)) continue;
      const matches = pattern.count(text);
      if (matches === 0) continue;
      counts[pattern.id] ??= {};
      counts[pattern.id][file] = matches;
    }
  }
  return counts;
}

function compareToBaseline(current, baseline) {
  const regressions = [];
  const improvements = [];
  const patternIds = new Set([...Object.keys(current), ...Object.keys(baseline)]);
  for (const pattern of [...patternIds].sort()) {
    const files = new Set([
      ...Object.keys(current[pattern] ?? {}),
      ...Object.keys(baseline[pattern] ?? {}),
    ]);
    for (const file of [...files].sort()) {
      const was = baseline[pattern]?.[file] ?? 0;
      const now = current[pattern]?.[file] ?? 0;
      if (now > was) regressions.push({ pattern, file, was, now });
      if (now < was) improvements.push({ pattern, file, was, now });
    }
  }
  return { regressions, improvements };
}

function formatReport({ regressions, improvements }) {
  const lines = [];
  if (regressions.length === 0) {
    lines.push('Design ratchet: OK');
  } else {
    lines.push('Design ratchet: patterns the visual rules forbid increased.');
    for (const { pattern, file, was, now } of regressions) {
      lines.push(`  ${pattern}: ${file} ${was} -> ${now}`);
    }
    lines.push(
      'If a file was only moved or renamed, run `node scripts/design-ratchet.mjs --update`',
      'and say why in the commit.',
    );
  }
  if (improvements.length > 0) {
    lines.push(
      `${improvements.length} count(s) went down. Run \`node scripts/design-ratchet.mjs --update\` to lock them in.`,
    );
  }
  return lines.join('\n');
}

const sortCounts = (counts) =>
  Object.fromEntries(
    Object.keys(counts)
      .sort()
      .map((pattern) => [
        pattern,
        Object.fromEntries(
          Object.keys(counts[pattern])
            .sort()
            .map((file) => [file, counts[pattern][file]]),
        ),
      ]),
  );

/** Checks the counts under `root` against the baseline `file`, or rewrites it when `update` is set. */
export async function runRatchet({
  root = websiteRoot,
  file = path.join(websiteRoot, 'scripts', 'design-ratchet-baseline.json'),
  update = false,
} = {}) {
  const current = collectCounts(await readSourceFiles(root));
  if (update) {
    await writeFile(file, `${JSON.stringify(sortCounts(current), null, 2)}\n`);
    return { exitCode: 0, stdout: 'Design ratchet baseline updated.' };
  }
  const result = compareToBaseline(current, JSON.parse(await readFile(file, 'utf8')));
  return { exitCode: result.regressions.length > 0 ? 1 : 0, stdout: formatReport(result) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { exitCode, stdout } = await runRatchet({ update: process.argv.includes('--update') });
  console.log(stdout);
  process.exitCode = exitCode;
}
