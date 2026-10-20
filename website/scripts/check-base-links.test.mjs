import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import test from 'node:test';

import { checkBaseLinks } from './check-base-links.mjs';

async function withDist(files, run) {
  const dir = await mkdtemp(path.join(tmpdir(), 'check-base-links-'));
  try {
    for (const [file, content] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(dir, file)), { recursive: true });
      await writeFile(path.join(dir, file), content);
    }
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('links under the base that resolve to files pass', async () => {
  await withDist(
    {
      'index.html':
        '<a href="/fieldnotes/">Home</a><a href="/fieldnotes/docs/intro/#x">Intro</a>' +
        '<script src="/fieldnotes/_astro/a.js"></script><a href="/fieldnotes/llms.txt?v=1">llms</a>' +
        '<a href="https://example.com/x">out</a><a href="docs/intro/">relative</a>',
      'docs/intro/index.html': '<a href="/fieldnotes/playground/?scene=embeds">Play</a>',
      '_astro/a.js': '',
      'llms.txt': '',
    },
    async (dir) => assert.deepEqual(await checkBaseLinks(dir, '/fieldnotes/'), []),
  );
});

test('a root-relative link missing the base fails and names the file', async () => {
  await withDist(
    { 'docs/intro/index.html': '<a href="/docs/other/">x</a><img src="/logo.svg">' },
    async (dir) =>
      assert.deepEqual(await checkBaseLinks(dir, '/fieldnotes/'), [
        'docs/intro/index.html: /docs/other/ is missing the base /fieldnotes/',
        'docs/intro/index.html: /logo.svg is missing the base /fieldnotes/',
      ]),
  );
});

test('an internal link that resolves to no file fails', async () => {
  await withDist(
    {
      'index.html':
        '<a href="/fieldnotes/docs/gone/">x</a><link href="/fieldnotes/_astro/gone.css">',
    },
    async (dir) =>
      assert.deepEqual(await checkBaseLinks(dir, '/fieldnotes/'), [
        'index.html: /fieldnotes/docs/gone/ resolves to no file',
        'index.html: /fieldnotes/_astro/gone.css resolves to no file',
      ]),
  );
});

test('under the default base a missing file still fails', async () => {
  await withDist({ 'index.html': '<a href="/docs/gone/">x</a>' }, async (dir) =>
    assert.deepEqual(await checkBaseLinks(dir, '/'), [
      'index.html: /docs/gone/ resolves to no file',
    ]),
  );
});

test('playground, dev and api are neither scanned nor resolved', async () => {
  await withDist(
    {
      'index.html': '<a href="/fieldnotes/dev/">dev</a><a href="/fieldnotes/api/x.html">api</a>',
      'playground/index.html': '<script src="/assets/a.js"></script>',
      'dev/index.html': '<a href="/nowhere/">x</a>',
      'api/index.html': '<a href="/fieldnotes/api/gone.html">x</a>',
    },
    async (dir) => assert.deepEqual(await checkBaseLinks(dir, '/fieldnotes/'), []),
  );
});

test('a JSON Pagefind fragment url is checked and a compressed one is skipped', async () => {
  await withDist(
    {
      'pagefind/fragment/en_a.pf_fragment': JSON.stringify({ url: '/docs/intro/' }),
      'pagefind/fragment/en_b.pf_fragment': gzipSync('pagefind_dcd{"url":"/docs/intro/"}'),
    },
    async (dir) =>
      assert.deepEqual(await checkBaseLinks(dir, '/fieldnotes/'), [
        'pagefind/fragment/en_a.pf_fragment: /docs/intro/ is missing the base /fieldnotes/',
      ]),
  );
});
