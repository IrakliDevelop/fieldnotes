import type { Page } from '@playwright/test';
import type { SceneId } from '../../src/scene';

/** Opens a scene on an empty board (`?blank` skips the first-visit sample). */
export async function gotoBlank(page: Page, scene: SceneId = 'whiteboard'): Promise<void> {
  await page.goto(`/?scene=${scene}&blank`);
  await page.waitForFunction(() => window.__playground !== undefined);
}
