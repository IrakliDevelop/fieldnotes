import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const websiteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const SOURCE_DIRS = ['src', 'content'];
const SOURCE_FILE = /\.(astro|css|ts|tsx|md|json)$/;
const EXCLUDED_FILE = /\.test\.|\.d\.ts$/;

async function listSourceFiles(root) {
  const lists = await Promise.all(
    SOURCE_DIRS.map(async (dir) => {
      // A scanned directory may not exist yet; any other read error is real.
      const entries = await readdir(path.join(root, dir), { recursive: true }).catch((error) => {
        if (error.code === 'ENOENT') return [];
        throw error;
      });
      return entries.map((entry) => path.posix.join(dir, entry.split(path.sep).join('/')));
    }),
  );
  return lists
    .flat()
    .filter((file) => SOURCE_FILE.test(file) && !EXCLUDED_FILE.test(file))
    .sort();
}

/** Reads every scanned file under `src` and `content` as `{ path, text }`, paths relative to `root`. */
export async function readSourceFiles(root = websiteRoot) {
  const files = await listSourceFiles(root);
  return Promise.all(
    files.map(async (file) => ({
      path: file,
      text: await readFile(path.join(root, file), 'utf8'),
    })),
  );
}
