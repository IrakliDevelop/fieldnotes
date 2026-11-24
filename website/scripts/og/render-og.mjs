// Renders the link preview image and PNG favicons into website/public:
//   node website/scripts/og/render-og.mjs
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const publicDir = new URL('../../public/', import.meta.url);
const families = ['Young Serif', 'Kalam', 'Public Sans', 'JetBrains Mono'];

const browser = await chromium.launch();
try {
  const og = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  });
  await og.goto(new URL('og.html', import.meta.url).href);
  // document.fonts.check passes for undeclared families, so require a loaded face for each.
  const loaded = await og.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts]
      .filter((face) => face.status === 'loaded')
      .map((face) => face.family);
  });
  const missing = families.filter((name) => !loaded.includes(name));
  if (missing.length) throw new Error(`fonts not loaded: ${missing.join(', ')}`);
  await og.screenshot({ path: fileURLToPath(new URL('og.png', publicDir)) });

  // Inlined because about:blank may not load file:// images.
  const svg = `data:image/svg+xml;base64,${readFileSync(new URL('favicon.svg', publicDir)).toString('base64')}`;
  const icons = [
    { file: 'favicon-32.png', size: 32, background: 'transparent' },
    { file: 'apple-touch-icon.png', size: 180, background: '#F9F9F6' },
  ];
  for (const { file, size, background } of icons) {
    const page = await browser.newPage({
      viewport: { width: size, height: size },
      deviceScaleFactor: 1,
    });
    await page.setContent(
      `<body style="margin:0;background:${background}"><img src="${svg}" width="${size}" height="${size}" style="display:block"></body>`,
    );
    await page.locator('img').evaluate((img) => img.decode());
    await page.screenshot({
      path: fileURLToPath(new URL(file, publicDir)),
      omitBackground: background === 'transparent',
    });
  }
} finally {
  await browser.close();
}
