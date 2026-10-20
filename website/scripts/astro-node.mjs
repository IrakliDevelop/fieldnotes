// Astro and Pagefind need Node 22.22; the repository's Node 20.19 floor skips them instead of failing.
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

function isSupported(version) {
  const [major = 0, minor = 0] = version.split('.').map(Number);
  return major > 22 || (major === 22 && minor >= 22);
}

/** Runs `argv` and resolves its exit code, or prints the skip line and resolves 0 below Node 22.22. */
export async function runIfSupported(argv, nodeVersion = process.versions.node, spawnFn = spawn) {
  if (!isSupported(nodeVersion)) {
    console.log(`skipped: the website needs Node 22.22 or newer (found ${nodeVersion})`);
    return 0;
  }
  const [command, ...args] = argv;
  return new Promise((resolve, reject) => {
    const child = spawnFn(command, args, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? 1));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runIfSupported(process.argv.slice(2));
}
