import assert from 'node:assert/strict';
import test from 'node:test';

import { runIfSupported } from './astro-node.mjs';

const node = process.execPath;

test('Node 20.19 skips without spawning and prints the skip line', async (t) => {
  const log = t.mock.method(console, 'log', () => {});
  const spawn = t.mock.fn();
  assert.equal(await runIfSupported(['astro', 'build'], '20.19.0', spawn), 0);
  assert.equal(spawn.mock.callCount(), 0);
  assert.deepEqual(log.mock.calls[0]?.arguments, [
    'skipped: the website needs Node 22.22 or newer (found 20.19.0)',
  ]);
});

test('Node 22.21 is still skipped', async (t) => {
  t.mock.method(console, 'log', () => {});
  const spawn = t.mock.fn();
  assert.equal(await runIfSupported(['astro', 'build'], '22.21.9', spawn), 0);
  assert.equal(spawn.mock.callCount(), 0);
});

test('Node 22.22 and newer run the command and return its exit code', async () => {
  for (const version of ['22.22.0', '26.10.0']) {
    assert.equal(await runIfSupported([node, '-e', 'process.exit(0)'], version), 0);
  }
});

test('a failing command returns its non-zero exit code', async () => {
  assert.equal(await runIfSupported([node, '-e', 'process.exit(3)'], '22.22.0'), 3);
});
