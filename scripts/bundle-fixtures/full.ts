import {
  createDefaultTools,
  exportImage,
  exportPdf,
  exportSvg,
  presentationFeature,
  Viewport,
} from '@fieldnotes/core';

const viewport = new Viewport(document.body, {
  tools: createDefaultTools(),
  minimap: true,
  plugins: [presentationFeature()],
});
void exportImage(viewport);
void exportSvg(viewport);
void exportPdf(viewport);
