import type { HtmlElement, Viewport } from '@fieldnotes/core';

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

// #region png
export async function downloadPng(viewport: Viewport): Promise<void> {
  const blob = await viewport.exportImage({ padding: 20 });
  if (blob) download(blob, 'board.png');
}
// #endregion png

// #region svg
export async function downloadSvg(viewport: Viewport): Promise<void> {
  const svg = await viewport.exportSVG({ padding: 20, background: '#ffffff' });
  download(new Blob([svg], { type: 'image/svg+xml' }), 'board.svg');
}
// #endregion svg

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

export function exportWithCards(viewport: Viewport): Promise<Blob | null> {
  return viewport.exportImage({
    renderHtml: (element) => (element.htmlType === 'initiative' ? drawCard(element) : null),
    onHtmlError: ({ elementId, reason }) => console.warn(`Left out ${elementId}: ${reason}`),
  });
}
// #endregion render-html
