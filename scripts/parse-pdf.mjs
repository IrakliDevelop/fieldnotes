#!/usr/bin/env node

/**
 * PDF parser script for exploring FreeForm PDF exports.
 *
 * Usage: node scripts/parse-pdf.mjs <path-to-pdf> [--extract-images <output-dir>]
 */

import fs from 'fs';
import path from 'path';
import { PDFDocument } from 'pdf-lib';

const pdfPath = process.argv[2];
const extractFlag = process.argv.indexOf('--extract-images');
const outputDir = extractFlag !== -1 ? process.argv[extractFlag + 1] : null;

if (!pdfPath) {
  console.error('Usage: node scripts/parse-pdf.mjs <path-to-pdf> [--extract-images <output-dir>]');
  process.exit(1);
}

const bytes = fs.readFileSync(pdfPath);
const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });

console.log('=== PDF METADATA ===');
console.log(`Title:    ${doc.getTitle() ?? '(none)'}`);
console.log(`Author:   ${doc.getAuthor() ?? '(none)'}`);
console.log(`Creator:  ${doc.getCreator() ?? '(none)'}`);
console.log(`Producer: ${doc.getProducer() ?? '(none)'}`);
console.log(`Pages:    ${doc.getPageCount()}`);
console.log();

// Analyze each page
const pages = doc.getPages();
for (let i = 0; i < pages.length; i++) {
  const page = pages[i];
  const { width, height } = page.getSize();
  console.log(`=== PAGE ${i + 1} ===`);
  console.log(`Size: ${width} x ${height} points (${(width / 72).toFixed(2)}" x ${(height / 72).toFixed(2)}")`);

  // Inspect page resources
  const resources = page.node.get(page.node.context.obj('Resources'));
  if (resources) {
    listResources(resources, page.node.context, i + 1);
  }
  console.log();
}

// Extract embedded objects from the raw PDF structure
console.log('=== RAW OBJECT SCAN ===');
const context = doc.context;
const allRefs = context.enumerateIndirectObjects();
const objectsByType = {};
let imageCount = 0;
const images = [];

for (const [ref, obj] of allRefs) {
  const dict = obj.dict ?? obj;
  if (dict && typeof dict.get === 'function') {
    const type = dict.get(context.obj('Type'))?.toString();
    const subtype = dict.get(context.obj('Subtype'))?.toString();
    const key = subtype || type || 'Unknown';

    if (!objectsByType[key]) objectsByType[key] = [];
    objectsByType[key].push(ref);

    if (subtype === '/Image') {
      imageCount++;
      const imgWidth = dict.get(context.obj('Width'))?.toString();
      const imgHeight = dict.get(context.obj('Height'))?.toString();
      const colorSpace = dict.get(context.obj('ColorSpace'))?.toString();
      const bitsPerComp = dict.get(context.obj('BitsPerComponent'))?.toString();
      const filter = dict.get(context.obj('Filter'))?.toString();
      const length = dict.get(context.obj('Length'))?.toString();

      console.log(`  Image #${imageCount}: ${imgWidth}x${imgHeight}, colorSpace=${colorSpace}, bits=${bitsPerComp}, filter=${filter}, length=${length}, ref=${ref}`);
      images.push({ ref, obj, dict, width: imgWidth, height: imgHeight, filter });
    }
  }
}

console.log();
console.log('=== OBJECT TYPE SUMMARY ===');
for (const [type, refs] of Object.entries(objectsByType).sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${type}: ${refs.length} objects`);
}

console.log();
console.log(`Total images found: ${imageCount}`);

// Extract images if requested
if (outputDir && images.length > 0) {
  fs.mkdirSync(outputDir, { recursive: true });
  console.log(`\nExtracting images to ${outputDir}/...`);

  for (let i = 0; i < images.length; i++) {
    const { obj, filter, width, height } = images[i];
    const stream = obj.getContentsString?.() ?? null;
    const rawBytes = obj.getContents?.() ?? null;

    if (rawBytes) {
      let ext = 'bin';
      if (filter === '/DCTDecode') ext = 'jpg';
      else if (filter === '/FlateDecode') ext = 'raw';
      else if (filter === '/JPXDecode') ext = 'jp2';
      else if (filter === '/CCITTFaxDecode') ext = 'tiff';

      const filename = `image_${i + 1}_${width}x${height}.${ext}`;
      fs.writeFileSync(path.join(outputDir, filename), rawBytes);
      console.log(`  Extracted: ${filename} (${rawBytes.length} bytes)`);
    } else {
      console.log(`  Image #${i + 1}: could not extract raw bytes`);
    }
  }
}

// Scan for text content streams
console.log('\n=== TEXT CONTENT ANALYSIS ===');
for (let i = 0; i < pages.length; i++) {
  const page = pages[i];
  const contents = page.node.get(page.node.context.obj('Contents'));
  if (contents) {
    const contentRefs = Array.isArray(contents) ? contents : [contents];
    console.log(`Page ${i + 1}: ${contentRefs.length} content stream(s)`);

    // Try to read content streams for text operators
    for (const contentRef of contentRefs) {
      try {
        const resolved = contentRef.toString?.() === undefined
          ? context.lookup(contentRef)
          : context.lookup(contentRef);

        if (resolved && typeof resolved.getContentsString === 'function') {
          const streamText = resolved.getContentsString();
          // Look for text operators
          const textBlocks = streamText.match(/BT[\s\S]*?ET/g) || [];
          const textStrings = streamText.match(/\(([^)]*)\)\s*Tj/g) || [];
          const tjArrays = streamText.match(/\[([^\]]*)\]\s*TJ/g) || [];

          if (textBlocks.length > 0 || textStrings.length > 0 || tjArrays.length > 0) {
            console.log(`  Text blocks (BT..ET): ${textBlocks.length}`);
            console.log(`  Simple text ops (Tj): ${textStrings.length}`);
            console.log(`  Array text ops (TJ): ${tjArrays.length}`);

            // Extract readable text
            const readable = [];
            for (const s of textStrings) {
              const match = s.match(/\(([^)]*)\)/);
              if (match) readable.push(match[1]);
            }
            for (const s of tjArrays) {
              const parts = s.match(/\(([^)]*)\)/g);
              if (parts) {
                readable.push(parts.map(p => p.slice(1, -1)).join(''));
              }
            }
            if (readable.length > 0) {
              console.log(`  Extracted text snippets:`);
              for (const t of readable.slice(0, 20)) {
                console.log(`    "${t}"`);
              }
              if (readable.length > 20) {
                console.log(`    ... and ${readable.length - 20} more`);
              }
            }
          }

          // Look for drawing operators (paths, strokes)
          const pathOps = (streamText.match(/\b[mlcvyh]\b/g) || []).length;
          const strokeOps = (streamText.match(/\b[SsfFBb]\b/g) || []).length;
          const imageOps = (streamText.match(/\/\w+\s+Do\b/g) || []).length;
          const gsaveOps = (streamText.match(/\bq\b/g) || []).length;

          console.log(`  Path operations (m/l/c): ${pathOps}`);
          console.log(`  Stroke/fill operations: ${strokeOps}`);
          console.log(`  Image placements (Do): ${imageOps}`);
          console.log(`  Graphics state saves (q): ${gsaveOps}`);
        }
      } catch {
        // skip unreadable streams
      }
    }
  }
}

// Helper to list page resources
function listResources(resources, context, pageNum) {
  const resourceTypes = ['Font', 'XObject', 'ExtGState', 'ColorSpace', 'Pattern', 'Shading'];

  for (const type of resourceTypes) {
    const dict = resources.get?.(context.obj(type));
    if (dict && typeof dict.entries === 'function') {
      const entries = dict.entries();
      if (entries.length > 0) {
        console.log(`  ${type}: ${entries.length} entries`);
        for (const [name, ref] of entries.slice(0, 10)) {
          const resolved = context.lookup(ref);
          const subtype = resolved?.dict?.get?.(context.obj('Subtype'))?.toString() ?? '';
          const extra = subtype ? ` (${subtype})` : '';
          console.log(`    ${name}${extra}`);
        }
        if (entries.length > 10) {
          console.log(`    ... and ${entries.length - 10} more`);
        }
      }
    }
  }
}
