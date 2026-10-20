// Fails a site build whose root-relative links miss FIELDNOTES_BASE or point at no file in it.
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Vite and TypeDoc build these into the site with their own bases.
const FOREIGN = ['playground/', 'dev/', 'api/'];
const ATTRIBUTE = /(?<![\w-])(?:href|src)="([^"]*)"/g;

async function urlsOf(dir, file) {
  const text = await readFile(path.join(dir, file), 'utf8');
  if (file.endsWith('.html')) return [...text.matchAll(ATTRIBUTE)].map((match) => match[1]);
  try {
    const { url } = JSON.parse(text);
    return typeof url === 'string' ? [url] : [];
  } catch {
    // Pagefind 1.5 gzips its fragments; those are covered by check-pagefind-base.mjs instead.
    return [];
  }
}

async function resolves(dir, sitePath) {
  const target = sitePath === '' || sitePath.endsWith('/') ? `${sitePath}index.html` : sitePath;
  return stat(path.join(dir, decodeURIComponent(target))).then(
    (entry) => entry.isFile(),
    () => false,
  );
}

/** Lists each link under `dir` that misses `base` or resolves to no file, as `file: url reason`. */
export async function checkBaseLinks(dir, base) {
  const files = (await readdir(dir, { recursive: true }))
    .map((file) => file.split(path.sep).join('/'))
    .filter(
      (file) =>
        !FOREIGN.some((prefix) => file.startsWith(prefix)) &&
        (file.endsWith('.html') || (file.startsWith('pagefind/') && file.endsWith('.pf_fragment'))),
    )
    .sort();
  const problems = [];
  for (const file of files) {
    for (const url of await urlsOf(dir, file)) {
      if (!url.startsWith('/') || url.startsWith('//')) continue;
      if (!url.startsWith(base)) {
        problems.push(`${file}: ${url} is missing the base ${base}`);
        continue;
      }
      const sitePath = url.slice(base.length).split(/[?#]/)[0] ?? '';
      if (FOREIGN.some((prefix) => sitePath.startsWith(prefix))) continue;
      if (!(await resolves(dir, sitePath))) problems.push(`${file}: ${url} resolves to no file`);
    }
  }
  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const base = process.env.FIELDNOTES_BASE ?? '/';
  const problems = await checkBaseLinks(process.argv[2], base);
  for (const problem of problems) console.error(problem);
  if (problems.length > 0) process.exitCode = 1;
  else console.log(`check-base-links: every link resolves under ${base}`);
}
