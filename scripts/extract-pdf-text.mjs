#!/usr/bin/env node

/**
 * Extract all text from a PDF with positions, font info, and grouping.
 *
 * Usage:
 *   node scripts/extract-pdf-text.mjs <path-to-pdf>
 *   node scripts/extract-pdf-text.mjs <path-to-pdf> --json          # output as JSON
 *   node scripts/extract-pdf-text.mjs <path-to-pdf> --plain         # plain text only
 *   node scripts/extract-pdf-text.mjs <path-to-pdf> --json > out.json
 */

import fs from 'fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const pdfPath = process.argv[2];
const format = process.argv.includes('--json') ? 'json' : process.argv.includes('--plain') ? 'plain' : 'detailed';

if (!pdfPath) {
  console.error('Usage: node scripts/extract-pdf-text.mjs <path-to-pdf> [--json | --plain]');
  process.exit(1);
}

const data = new Uint8Array(fs.readFileSync(pdfPath));
const doc = await getDocument({ data, useSystemFonts: true }).promise;

const result = {
  file: pdfPath,
  pages: [],
  totalItems: 0,
  totalChars: 0,
};

for (let i = 1; i <= doc.numPages; i++) {
  const page = await doc.getPage(i);
  const viewport = page.getViewport({ scale: 1 });
  const textContent = await page.getTextContent();

  const pageData = {
    page: i,
    width: viewport.width,
    height: viewport.height,
    items: [],
  };

  for (const item of textContent.items) {
    if (!item.str && !item.hasEOL) continue;

    const [a, b, c, d, tx, ty] = item.transform;
    const fontSize = Math.sqrt(a * a + b * b);
    const rotation = Math.atan2(b, a) * (180 / Math.PI);

    const textItem = {
      text: item.str,
      x: tx,
      y: ty,
      fontSize: Math.round(fontSize * 100) / 100,
      width: item.width,
      height: item.height,
      fontName: item.fontName,
      hasEOL: item.hasEOL || false,
    };

    if (Math.abs(rotation) > 0.1) {
      textItem.rotation = Math.round(rotation * 100) / 100;
    }

    pageData.items.push(textItem);
    result.totalChars += item.str.length;
  }

  result.totalItems += pageData.items.length;
  result.pages.push(pageData);
}

await doc.destroy();

if (format === 'json') {
  console.log(JSON.stringify(result, null, 2));
} else if (format === 'plain') {
  for (const page of result.pages) {
    // Group items into lines by y-coordinate proximity
    const lines = groupIntoLines(page.items, 3);
    for (const line of lines) {
      console.log(line.map(i => i.text).join(''));
    }
    if (result.pages.length > 1) console.log('\n--- Page Break ---\n');
  }
} else {
  // Detailed format
  for (const page of result.pages) {
    console.log(`=== PAGE ${page.page} (${page.width.toFixed(1)} x ${page.height.toFixed(1)} pts) ===`);
    console.log(`Text items: ${page.items.length}\n`);

    const lines = groupIntoLines(page.items, 3);

    for (const line of lines) {
      const firstItem = line[0];
      const lineText = line.map(i => i.text).join('');
      const font = firstItem.fontName;
      const size = firstItem.fontSize;
      console.log(`  [${firstItem.x.toFixed(1)}, ${firstItem.y.toFixed(1)}] (${font}, ${size}pt) "${lineText}"`);
    }

    console.log();
  }

  console.log(`--- SUMMARY ---`);
  console.log(`Total text items: ${result.totalItems}`);
  console.log(`Total characters: ${result.totalChars}`);
  console.log(`Fonts used:`);

  const fonts = new Set();
  for (const page of result.pages) {
    for (const item of page.items) {
      if (item.fontName) fonts.add(item.fontName);
    }
  }
  for (const font of [...fonts].sort()) {
    console.log(`  ${font}`);
  }
}

function groupIntoLines(items, threshold) {
  if (items.length === 0) return [];

  // Sort by y (descending — PDF coords) then x (ascending)
  const sorted = [...items].sort((a, b) => {
    const dy = b.y - a.y;
    if (Math.abs(dy) > threshold) return dy;
    return a.x - b.x;
  });

  const lines = [];
  let currentLine = [sorted[0]];
  let currentY = sorted[0].y;

  for (let i = 1; i < sorted.length; i++) {
    const item = sorted[i];
    if (Math.abs(item.y - currentY) <= threshold) {
      currentLine.push(item);
    } else {
      // Sort current line by x before pushing
      currentLine.sort((a, b) => a.x - b.x);
      lines.push(currentLine);
      currentLine = [item];
      currentY = item.y;
    }
  }
  currentLine.sort((a, b) => a.x - b.x);
  lines.push(currentLine);

  return lines;
}
