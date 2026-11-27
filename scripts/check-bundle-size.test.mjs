import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./check-bundle-size.mjs', import.meta.url));
const dirs = [];
after(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));

async function run(limits) {
  const dir = await mkdtemp(join(tmpdir(), 'bundle-check-'));
  dirs.push(dir);
  await writeFile(join(dir, 'used-mod.ts'), "export const used = 'x'.repeat(4000);\n");
  await writeFile(join(dir, 'unused-mod.ts'), 'export const unused = 1;\n');
  await writeFile(
    join(dir, 'barrel.ts'),
    "export * from './used-mod';\nexport * from './unused-mod';\n",
  );
  await writeFile(join(dir, 'app.ts'), "import { used } from './barrel';\nconsole.log(used);\n");
  const limitsPath = join(dir, 'limits.json');
  await writeFile(limitsPath, JSON.stringify(limits));
  return spawnSync('node', [script, '--limits', limitsPath, '--fixtures', dir], {
    encoding: 'utf8',
  });
}

test('fails and names the fixture when its gzip size exceeds the limit', async () => {
  const result = await run({ app: { gzip: 10, forbidden: [] } });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /app/);
});

test('fails and names the module when a contributing input matches a forbidden entry', async () => {
  const result = await run({ app: { gzip: 100000, forbidden: ['/used-mod'] } });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /app.*used-mod\.ts/);
});

test('passes when within limits and forbidden modules contribute no output bytes', async () => {
  const result = await run({ app: { gzip: 100000, forbidden: ['unused-mod', 'barrel'] } });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /app/);
});
