import type { Page } from '@playwright/test';

declare global {
  interface Window {
    /** Flattens the base canvas and every hybrid stratum, in paint order, into a new canvas. */
    __fnCompositeCanvas(): HTMLCanvasElement;
  }
}

/** Installs `window.__fnCompositeCanvas` on every document the page loads. */
export async function installCompositeCanvas(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.__fnCompositeCanvas = () => {
      // The base canvas sits in a wrapper div, so a child combinator would miss it.
      const base = document.querySelector('#canvas canvas:not([data-paint-order])');
      if (!(base instanceof HTMLCanvasElement)) throw new Error('base canvas not found');
      const out = document.createElement('canvas');
      out.width = base.width;
      out.height = base.height;
      const ctx = out.getContext('2d');
      if (!ctx) throw new Error('composite canvas has no 2d context');
      const strata = [
        ...document.querySelectorAll<HTMLCanvasElement>('#canvas canvas[data-paint-order]'),
      ].sort((a, b) => Number(a.dataset['paintOrder']) - Number(b.dataset['paintOrder']));
      for (const canvas of [base, ...strata]) ctx.drawImage(canvas, 0, 0);
      return out;
    };
  });
}
