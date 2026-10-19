import type { Page } from '@playwright/test';
import type { SceneId } from '../../src/scene';

/** Opens a scene on an empty board (`?blank` skips the first-visit sample). */
export async function gotoBlank(page: Page, scene: SceneId = 'whiteboard'): Promise<void> {
  await page.goto(`/?scene=${scene}&blank`);
  await page.waitForFunction(() => window.__playground !== undefined);
}

/** Records every blob passed to `URL.createObjectURL` in `window.exportedBlobs`. */
export async function captureExportedBlobs(page: Page): Promise<void> {
  // No Node types here, so tests read exported blobs in the page instead of from disk.
  await page.addInitScript(() => {
    const blobs: Blob[] = [];
    Object.assign(window, { exportedBlobs: blobs });
    const create = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob: Blob | MediaSource) => {
      if (blob instanceof Blob) blobs.push(blob);
      return create(blob);
    };
  });
}
