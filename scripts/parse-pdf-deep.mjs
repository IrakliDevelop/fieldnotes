#!/usr/bin/env node

/**
 * Deep PDF content stream analyzer — uses pdf.js to properly decompress
 * and parse content streams, extracting coordinates, identifying sticky
 * notes, and analyzing pencil strokes.
 *
 * Usage: node scripts/parse-pdf-deep.mjs <path-to-pdf>
 */

import fs from 'fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const pdfPath = process.argv[2];
if (!pdfPath) {
  console.error('Usage: node scripts/parse-pdf-deep.mjs <path-to-pdf>');
  process.exit(1);
}

const data = new Uint8Array(fs.readFileSync(pdfPath));
const doc = await getDocument({ data, useSystemFonts: true }).promise;

console.log(`Pages: ${doc.numPages}\n`);

for (let i = 1; i <= doc.numPages; i++) {
  const page = await doc.getPage(i);
  const viewport = page.getViewport({ scale: 1 });
  console.log(`=== PAGE ${i} (${viewport.width.toFixed(1)} x ${viewport.height.toFixed(1)} pts) ===\n`);

  // Get operator list — pdf.js's parsed representation of the content stream
  const opList = await page.getOperatorList();

  // Get text content
  const textContent = await page.getTextContent();

  analyzeOperators(opList, viewport);
  analyzeText(textContent);

  console.log();
}

await doc.destroy();

function analyzeOperators(opList, viewport) {
  const OPS = {
    // From pdf.js OPS enum
    setLineWidth: 1,
    setLineCap: 2,
    setLineJoin: 3,
    setMiterLimit: 4,
    setDash: 5,
    setRenderingIntent: 6,
    setFlatness: 7,
    setGState: 8,
    save: 10,
    restore: 11,
    transform: 12,
    moveTo: 13,
    lineTo: 14,
    curveTo: 15,
    curveTo2: 16,
    curveTo3: 17,
    closePath: 18,
    rectangle: 19,
    stroke: 20,
    closeStroke: 21,
    fill: 22,
    eoFill: 23,
    fillStroke: 24,
    eoFillStroke: 25,
    closeFillStroke: 26,
    closeEOFillStroke: 27,
    endPath: 28,
    clip: 29,
    eoClip: 30,
    beginText: 31,
    endText: 32,
    setCharSpacing: 33,
    setWordSpacing: 34,
    setHScale: 35,
    setLeading: 36,
    setFont: 37,
    setTextRenderingMode: 38,
    setTextRise: 39,
    moveText: 40,
    setLeadingMoveText: 41,
    setTextMatrix: 42,
    nextLine: 43,
    showText: 44,
    showSpacedText: 45,
    nextLineShowText: 46,
    nextLineSetSpacingShowText: 47,
    setCharWidth: 48,
    setCharWidthAndBounds: 49,
    setStrokeColorSpace: 50,
    setFillColorSpace: 51,
    setStrokeColor: 52,
    setStrokeColorN: 53,
    setFillColor: 54,
    setFillColorN: 55,
    setStrokeGray: 56,
    setFillGray: 57,
    setStrokeRGBColor: 58,
    setFillRGBColor: 59,
    setStrokeCMYKColor: 60,
    setFillCMYKColor: 61,
    shadingFill: 62,
    beginInlineImage: 63,
    beginImageData: 64,
    endInlineImage: 65,
    paintXObject: 66,
    markPoint: 67,
    markPointProps: 68,
    beginMarkedContent: 69,
    beginMarkedContentProps: 70,
    endMarkedContent: 71,
    beginCompat: 72,
    endCompat: 73,
    paintFormXObjectBegin: 74,
    paintFormXObjectEnd: 75,
    beginGroup: 76,
    endGroup: 77,
    beginAnnotation: 80,
    endAnnotation: 81,
    paintImageMaskXObject: 83,
    paintImageMaskXObjectGroup: 84,
    paintImageXObject: 85,
    paintInlineImageXObject: 86,
    paintInlineImageXObjectGroup: 87,
    paintImageXObjectRepeat: 88,
    paintImageMaskXObjectRepeat: 89,
    paintSolidColorImageMask: 90,
    constructPath: 91,
    setStrokeTransparent: 92,
    setFillTransparent: 93,
  };

  // Reverse map for names
  const opNames = {};
  for (const [name, code] of Object.entries(OPS)) {
    opNames[code] = name;
  }

  // Count operations
  const opCounts = {};
  for (const fn of opList.fnArray) {
    const name = opNames[fn] || `unknown(${fn})`;
    opCounts[name] = (opCounts[name] || 0) + 1;
  }

  console.log('--- OPERATION COUNTS ---');
  for (const [name, count] of Object.entries(opCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${name}: ${count}`);
  }

  // Track graphics state for coordinate extraction
  let matrixStack = [];
  let currentMatrix = [1, 0, 0, 1, 0, 0];
  let currentStrokeColor = null;
  let currentFillColor = null;
  let currentLineWidth = 1;

  const imagePlacements = [];
  const rectangles = [];
  const strokes = [];
  let currentPath = [];

  for (let idx = 0; idx < opList.fnArray.length; idx++) {
    const fn = opList.fnArray[idx];
    const args = opList.argsArray[idx];

    switch (fn) {
      case OPS.save:
        matrixStack.push({
          matrix: [...currentMatrix],
          strokeColor: currentStrokeColor,
          fillColor: currentFillColor,
          lineWidth: currentLineWidth,
        });
        break;

      case OPS.restore: {
        const saved = matrixStack.pop();
        if (saved) {
          currentMatrix = saved.matrix;
          currentStrokeColor = saved.strokeColor;
          currentFillColor = saved.fillColor;
          currentLineWidth = saved.lineWidth;
        }
        break;
      }

      case OPS.transform: {
        const [a, b, c, d, e, f] = args;
        const prev = currentMatrix;
        currentMatrix = [
          prev[0] * a + prev[2] * b,
          prev[1] * a + prev[3] * b,
          prev[0] * c + prev[2] * d,
          prev[1] * c + prev[3] * d,
          prev[0] * e + prev[2] * f + prev[4],
          prev[1] * e + prev[3] * f + prev[5],
        ];
        break;
      }

      case OPS.setLineWidth:
        currentLineWidth = args[0];
        break;

      case OPS.setStrokeRGBColor:
        currentStrokeColor = { r: args[0], g: args[1], b: args[2] };
        break;

      case OPS.setFillRGBColor:
        currentFillColor = { r: args[0], g: args[1], b: args[2] };
        break;

      case OPS.setStrokeGray:
        currentStrokeColor = { r: args[0], g: args[0], b: args[0] };
        break;

      case OPS.setFillGray:
        currentFillColor = { r: args[0], g: args[0], b: args[0] };
        break;

      case OPS.constructPath: {
        const ops = args[0];
        const pathArgs = args[1];
        let argIdx = 0;

        for (const op of ops) {
          switch (op) {
            case OPS.moveTo:
              if (currentPath.length > 0) {
                // save previous subpath
              }
              currentPath.push({ type: 'M', x: pathArgs[argIdx++], y: pathArgs[argIdx++] });
              break;
            case OPS.lineTo:
              currentPath.push({ type: 'L', x: pathArgs[argIdx++], y: pathArgs[argIdx++] });
              break;
            case OPS.curveTo:
              currentPath.push({
                type: 'C',
                cp1x: pathArgs[argIdx++], cp1y: pathArgs[argIdx++],
                cp2x: pathArgs[argIdx++], cp2y: pathArgs[argIdx++],
                x: pathArgs[argIdx++], y: pathArgs[argIdx++],
              });
              break;
            case OPS.curveTo2:
              currentPath.push({
                type: 'C2',
                cp1x: pathArgs[argIdx++], cp1y: pathArgs[argIdx++],
                x: pathArgs[argIdx++], y: pathArgs[argIdx++],
              });
              break;
            case OPS.curveTo3:
              currentPath.push({
                type: 'C3',
                cp1x: pathArgs[argIdx++], cp1y: pathArgs[argIdx++],
                x: pathArgs[argIdx++], y: pathArgs[argIdx++],
              });
              break;
            case OPS.rectangle:
              rectangles.push({
                x: pathArgs[argIdx++],
                y: pathArgs[argIdx++],
                w: pathArgs[argIdx++],
                h: pathArgs[argIdx++],
                fillColor: currentFillColor ? { ...currentFillColor } : null,
                strokeColor: currentStrokeColor ? { ...currentStrokeColor } : null,
                matrix: [...currentMatrix],
              });
              break;
            case OPS.closePath:
              currentPath.push({ type: 'Z' });
              break;
          }
        }
        break;
      }

      case OPS.stroke:
      case OPS.closeStroke:
        if (currentPath.length > 0) {
          strokes.push({
            points: [...currentPath],
            color: currentStrokeColor ? { ...currentStrokeColor } : null,
            lineWidth: currentLineWidth,
            matrix: [...currentMatrix],
            type: 'stroke',
          });
          currentPath = [];
        }
        break;

      case OPS.fill:
      case OPS.eoFill:
        if (currentPath.length > 0) {
          strokes.push({
            points: [...currentPath],
            color: currentFillColor ? { ...currentFillColor } : null,
            lineWidth: currentLineWidth,
            matrix: [...currentMatrix],
            type: 'fill',
          });
          currentPath = [];
        }
        break;

      case OPS.fillStroke:
      case OPS.eoFillStroke:
        if (currentPath.length > 0) {
          strokes.push({
            points: [...currentPath],
            fillColor: currentFillColor ? { ...currentFillColor } : null,
            strokeColor: currentStrokeColor ? { ...currentStrokeColor } : null,
            lineWidth: currentLineWidth,
            matrix: [...currentMatrix],
            type: 'fillStroke',
          });
          currentPath = [];
        }
        break;

      case OPS.endPath:
        currentPath = [];
        break;

      case OPS.paintImageXObject:
      case OPS.paintImageMaskXObject: {
        const [a, b, c, d, tx, ty] = currentMatrix;
        imagePlacements.push({
          name: args[0],
          matrix: [...currentMatrix],
          tx, ty,
          renderedWidth: Math.sqrt(a * a + b * b),
          renderedHeight: Math.sqrt(c * c + d * d),
        });
        break;
      }
    }
  }

  // === REPORT ===

  console.log(`\n--- IMAGE PLACEMENTS (${imagePlacements.length}) ---`);
  for (const img of imagePlacements.slice(0, 30)) {
    console.log(`  ${img.name}: pos=(${img.tx.toFixed(1)}, ${img.ty.toFixed(1)}), size=(${img.renderedWidth.toFixed(1)} x ${img.renderedHeight.toFixed(1)})`);
  }
  if (imagePlacements.length > 30) {
    console.log(`  ... and ${imagePlacements.length - 30} more`);
  }

  // Colored rectangles (potential sticky notes)
  const coloredRects = rectangles.filter(r => {
    if (!r.fillColor) return false;
    const { r: red, g, b } = r.fillColor;
    // Not white, not black, not near-white
    return !(red > 0.95 && g > 0.95 && b > 0.95) && !(red < 0.05 && g < 0.05 && b < 0.05);
  });

  console.log(`\n--- RECTANGLES (${rectangles.length} total, ${coloredRects.length} colored) ---`);
  for (const rect of coloredRects) {
    const { r, g, b } = rect.fillColor;
    const hex = `#${Math.round(r * 255).toString(16).padStart(2, '0')}${Math.round(g * 255).toString(16).padStart(2, '0')}${Math.round(b * 255).toString(16).padStart(2, '0')}`;
    const [a, , , d, tx, ty] = rect.matrix;
    const worldX = tx + rect.x * a;
    const worldY = ty + rect.y * d;
    const worldW = rect.w * Math.abs(a);
    const worldH = rect.h * Math.abs(d);
    console.log(`  rect: world_pos=(${worldX.toFixed(1)}, ${worldY.toFixed(1)}), world_size=(${worldW.toFixed(1)} x ${worldH.toFixed(1)}), color=${hex}`);
  }

  // Path/stroke analysis
  const pencilStrokes = strokes.filter(s =>
    s.type === 'stroke' && s.points.filter(p => p.type === 'C').length >= 2
  );
  const fillPaths = strokes.filter(s => s.type === 'fill');
  const simpleStrokes = strokes.filter(s =>
    s.type === 'stroke' && s.points.filter(p => p.type === 'C').length < 2
  );

  console.log(`\n--- STROKES/PATHS (${strokes.length} total) ---`);
  console.log(`  Pencil-like (curved strokes): ${pencilStrokes.length}`);
  console.log(`  Simple strokes (lines): ${simpleStrokes.length}`);
  console.log(`  Fill paths: ${fillPaths.length}`);

  if (pencilStrokes.length > 0) {
    console.log(`\n  Sample pencil strokes (first 10):`);
    for (const s of pencilStrokes.slice(0, 10)) {
      const curves = s.points.filter(p => p.type === 'C').length;
      const color = s.color
        ? `#${Math.round(s.color.r * 255).toString(16).padStart(2, '0')}${Math.round(s.color.g * 255).toString(16).padStart(2, '0')}${Math.round(s.color.b * 255).toString(16).padStart(2, '0')}`
        : 'default';
      const start = s.points[0];
      const end = s.points[s.points.length - 1];
      const [a, b, c, d, tx, ty] = s.matrix;

      // Transform start point to page coordinates
      const startX = start.x * a + start.y * c + tx;
      const startY = start.x * b + start.y * d + ty;
      const endPt = end.x !== undefined ? end : { x: end.cp2x, y: end.cp2y };
      const endX = endPt.x * a + endPt.y * c + tx;
      const endY = endPt.x * b + endPt.y * d + ty;

      console.log(`    ${s.points.length} pts (${curves} curves), width=${s.lineWidth.toFixed(2)}, color=${color}`);
      console.log(`      page_start=(${startX.toFixed(1)}, ${startY.toFixed(1)}), page_end=(${endX.toFixed(1)}, ${endY.toFixed(1)})`);
      console.log(`      transform=[${s.matrix.map(v => v.toFixed(4)).join(', ')}]`);
    }
  }
}

function analyzeText(textContent) {
  if (textContent.items.length === 0) {
    console.log('\n--- TEXT: none ---');
    return;
  }

  console.log(`\n--- TEXT ITEMS (${textContent.items.length}) ---`);
  for (const item of textContent.items.slice(0, 30)) {
    if (item.str && item.str.trim()) {
      const { transform } = item;
      const tx = transform[4];
      const ty = transform[5];
      const fontSize = Math.sqrt(transform[0] * transform[0] + transform[1] * transform[1]);
      console.log(`  pos=(${tx.toFixed(1)}, ${ty.toFixed(1)}), size=${fontSize.toFixed(1)}, "${item.str}"`);
    }
  }
  if (textContent.items.length > 30) {
    const remaining = textContent.items.filter(i => i.str && i.str.trim()).length;
    console.log(`  ... ${remaining} total text items`);
  }
}
