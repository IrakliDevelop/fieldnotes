import { createDefaultTools, exportImage, exportPdf, exportSvg, Viewport } from '@fieldnotes/core';

const viewport = new Viewport(document.body, { tools: createDefaultTools(), minimap: true });
void exportImage(viewport);
void exportSvg(viewport);
void exportPdf(viewport);
