import {
  createDefaultTools,
  defaultFeatures,
  exportImage,
  exportPdf,
  exportSvg,
  minimapFeature,
  Viewport,
} from '@fieldnotes/core';

const viewport = new Viewport(document.body, {
  tools: createDefaultTools(),
  plugins: [...defaultFeatures(), minimapFeature()],
});
void exportImage(viewport);
void exportSvg(viewport);
void exportPdf(viewport);
