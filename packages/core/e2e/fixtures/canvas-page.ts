import { test as base, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

interface CanvasPageFixtures {
  canvasPage: CanvasPage;
}

export class CanvasPage {
  constructor(readonly page: Page) {}

  async goto() {
    await this.page.goto('/');
    await this.page.waitForSelector('#canvas canvas');
    await this.page.waitForTimeout(500);
  }

  async selectTool(name: string) {
    const button = this.page.locator(`#toolbar button[data-tool="${name}"]`);
    await button.scrollIntoViewIfNeeded();
    await button.click();
  }

  async getElementCount(): Promise<number> {
    return this.page.evaluate(() => {
      const vp = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
        store: { count: number };
      };
      return vp.store.count;
    });
  }

  async getElementsByType(type: string): Promise<unknown[]> {
    return this.page.evaluate((t) => {
      const vp = (window as unknown as Record<string, unknown>).__fieldnotes_viewport as {
        store: { getElementsByType: (type: string) => unknown[] };
      };
      return vp.store.getElementsByType(t);
    }, type);
  }

  canvas() {
    return this.page.locator('#canvas canvas');
  }

  wrapper() {
    return this.page.locator('#canvas > div');
  }
}

export const test = base.extend<CanvasPageFixtures>({
  canvasPage: async ({ page }, use) => {
    const cp = new CanvasPage(page);
    await cp.goto();
    await use(cp);
  },
});

export { expect };
