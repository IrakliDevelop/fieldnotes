import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { collectCounts, runRatchet } from './design-ratchet.mjs';

const count = (text, file = 'src/a.css') => collectCounts([{ path: file, text }]);

async function withFixture(files, baseline, run) {
  const root = await mkdtemp(path.join(tmpdir(), 'design-ratchet-'));
  try {
    for (const [file, text] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(root, file)), { recursive: true });
      await writeFile(path.join(root, file), text);
    }
    const file = path.join(root, 'baseline.json');
    await writeFile(file, `${JSON.stringify(baseline)}\n`);
    return await run({ root, file });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('one gradient over the baseline fails and names the file', async () => {
  await withFixture(
    { 'src/styles/a.css': 'a { background: linear-gradient(red, blue) }' },
    {},
    async (options) => {
      const result = await runRatchet(options);
      assert.equal(result.exitCode, 1);
      assert.match(result.stdout, /gradient: src\/styles\/a\.css 0 -> 1/);
    },
  );
});

test('a count equal to the baseline passes', async () => {
  await withFixture(
    { 'src/styles/a.css': 'a { background: radial-gradient(red, blue) }' },
    { gradient: { 'src/styles/a.css': 1 } },
    async (options) => assert.equal((await runRatchet(options)).exitCode, 0),
  );
});

test('content files are counted and test files are not', async () => {
  await withFixture(
    { 'content/docs/a.md': 'Hello 🎉', 'src/lib/a.test.ts': "'conic-gradient'" },
    {},
    async (options) => {
      const result = await runRatchet(options);
      assert.equal(result.exitCode, 1);
      assert.match(result.stdout, /emoji: content\/docs\/a\.md 0 -> 1/);
      assert.doesNotMatch(result.stdout, /a\.test\.ts/);
    },
  );
});

test('allow-listed files are ignored for gradients only', () => {
  const gradient = 'background: repeating-linear-gradient(red, blue); text-transform: uppercase;';
  assert.deepEqual(count(gradient, 'src/components/Hero.astro'), {
    uppercase: { 'src/components/Hero.astro': 1 },
  });
  assert.deepEqual(count(gradient, 'src/styles/board-placeholder.css'), {
    uppercase: { 'src/styles/board-placeholder.css': 1 },
  });
});

test('box-shadow: none is not counted and any other box-shadow is', () => {
  assert.deepEqual(count('a { box-shadow: none; box-shadow:none }'), {});
  assert.deepEqual(count('a { box-shadow: 0 1px 2px red }'), { 'box-shadow': { 'src/a.css': 1 } });
});

test('an emoji is counted', () => {
  assert.deepEqual(count('<p>Draw ✏️ here 🎉</p>'), { emoji: { 'src/a.css': 2 } });
});

test('counts backdrop-filter and uppercase', () => {
  assert.deepEqual(count('a { backdrop-filter: blur(4px); text-transform:  uppercase }'), {
    'backdrop-filter': { 'src/a.css': 1 },
    uppercase: { 'src/a.css': 1 },
  });
});

test('letter-spacing counts only values above 0.02em', () => {
  const allowed =
    'letter-spacing: 0.02em; letter-spacing: -0.01em; letter-spacing: normal; letter-spacing: 0;';
  assert.deepEqual(count(allowed), {});
  assert.deepEqual(count('letter-spacing: 0.05em; letter-spacing: 2px;'), {
    'letter-spacing': { 'src/a.css': 2 },
  });
});

test('font-family counts names outside the four site fonts and generic fallbacks', () => {
  const allowed = [
    "font-family: 'Young Serif', serif;",
    'font-family: "Public Sans", sans-serif;',
    'font-family: Kalam, cursive;',
    "font-family: 'JetBrains Mono', ui-monospace, monospace;",
    'font-family: inherit;',
  ].join('\n');
  assert.deepEqual(count(allowed), {});
  assert.deepEqual(count("font-family: 'Young Serif', Georgia, 'Helvetica Neue', serif;"), {
    'font-family': { 'src/a.css': 2 },
  });
});

test('--update rewrites the baseline with the current counts', async () => {
  await withFixture(
    { 'src/a.css': 'a { box-shadow: 0 0 1px red }' },
    { gradient: { 'src/old.css': 3 } },
    async (options) => {
      assert.equal((await runRatchet({ ...options, update: true })).exitCode, 0);
      assert.deepEqual(JSON.parse(await readFile(options.file, 'utf8')), {
        'box-shadow': { 'src/a.css': 1 },
      });
    },
  );
});
