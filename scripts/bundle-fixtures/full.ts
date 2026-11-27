import { createDefaultTools, Viewport } from '@fieldnotes/core';

const viewport = new Viewport(document.body, { tools: createDefaultTools(), minimap: true });
void viewport.exportImage();
void viewport.exportSVG();
void viewport.exportPDF();
