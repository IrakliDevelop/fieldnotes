// Serves a FIELDNOTES_BASE build under its base and fails unless docs search results link under it.
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { chromium } from '@playwright/test';

const dist = path.resolve(process.argv[2]);
const base = process.env.FIELDNOTES_BASE ?? '/';
// Module scripts need a JavaScript MIME type; everything else Pagefind fetches as bytes.
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

const server = http.createServer(async (request, response) => {
  // URL parsing drops `..` segments, so the path stays inside `dist`.
  const { pathname } = new URL(request.url ?? '/', 'http://localhost');
  const sitePath = decodeURIComponent(pathname.slice(base.length));
  const file = sitePath === '' || sitePath.endsWith('/') ? `${sitePath}index.html` : sitePath;
  const body = pathname.startsWith(base)
    ? await readFile(path.join(dist, file)).catch(() => null)
    : null;
  if (body === null) {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, {
    'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream',
  });
  response.end(body);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

let browser;
try {
  const { port } = server.address();
  browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}${base}docs/getting-started/`);
  await page.locator('#docs-search').fill('viewport');
  const href = await page.locator('[data-search-results] a').first().getAttribute('href');
  if (href?.startsWith(base)) {
    console.log(`check-pagefind-base: first result ${href} is under ${base}`);
  } else {
    console.error(`check-pagefind-base: first result ${href} is not under ${base}`);
    process.exitCode = 1;
  }
} finally {
  await browser?.close();
  server.close();
}
