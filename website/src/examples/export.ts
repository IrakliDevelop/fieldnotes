import {
  exportImage,
  exportPdf as exportPdfBlob,
  exportSvg as exportSvgString,
  isFrameElement,
  setTextFontFamily,
  type HtmlElement,
  type Viewport,
} from '@fieldnotes/core';

type PdfViewport = Pick<Viewport, 'exportDefaults'> & {
  store: Pick<Viewport['store'], 'getAll'>;
};

// #region font-family
setTextFontFamily('Inter, system-ui, sans-serif');
// #endregion font-family

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

export async function exportPng(viewport: Viewport): Promise<void> {
  // #region png
  const blob = await exportImage(viewport, { padding: 20 });
  if (blob) download(blob, 'board.png');
  // #endregion png
}

export async function exportSvg(viewport: Viewport): Promise<void> {
  // #region svg
  const svg = await exportSvgString(viewport, { padding: 20, background: '#ffffff' });
  download(new Blob([svg], { type: 'image/svg+xml' }), 'board.svg');
  // #endregion svg
}

// #region fonts
export async function exportSvgWithFonts(viewport: Viewport): Promise<void> {
  const svg = await exportSvgString(viewport, {
    fonts: [{ family: 'Inter', src: '/fonts/inter.woff2' }],
  });
  download(new Blob([svg], { type: 'image/svg+xml' }), 'board.svg');
}
// #endregion fonts

// #region pdf
export async function exportPdf(viewport: PdfViewport): Promise<void> {
  const frameIds = viewport.store
    .getAll()
    .filter(isFrameElement)
    .filter((frame) => frame.parentId === undefined)
    .map((frame) => frame.id);
  const blob = await exportPdfBlob(viewport, {
    ...(frameIds.length > 0 ? { frameIds } : {}),
    pageSize: 'a4',
  });
  if (blob) download(blob, 'board.pdf');
}
// #endregion pdf

// #region render-html
function drawCard(element: HtmlElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  // Twice the element size, to match the default export scale of 2.
  canvas.width = element.size.w * 2;
  canvas.height = element.size.h * 2;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.scale(2, 2);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, element.size.w, element.size.h);
  ctx.fillStyle = '#2a2d31';
  ctx.font = '600 18px sans-serif';
  const title = element.data?.title;
  ctx.fillText(typeof title === 'string' ? title : '', 16, 32);
  return canvas;
}
// #endregion render-html

export async function exportWithCards(viewport: Viewport): Promise<void> {
  // #region render-html
  const blob = await exportImage(viewport, {
    renderHtml: (element) => (element.htmlType === 'initiative' ? drawCard(element) : null),
    onHtmlError: ({ elementId, reason }) => console.warn(`Left out ${elementId}: ${reason}`),
  });
  if (blob) download(blob, 'board.png');
  // #endregion render-html
}
