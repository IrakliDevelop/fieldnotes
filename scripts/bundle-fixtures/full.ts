import {
  createDefaultTools,
  defaultFeatures,
  exportImage,
  exportPdf,
  exportSvg,
  Viewport,
} from '@fieldnotes/core';

const viewport = new Viewport(document.body, {
  tools: createDefaultTools(),
  minimap: true,
  plugins: defaultFeatures(),
});
void exportImage(viewport);
void exportSvg(viewport);
void exportPdf(viewport);
