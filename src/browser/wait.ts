import { type Page } from 'playwright';

export async function waitForPageReady(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => undefined);
  await page.locator('h1, form').first().waitFor({ state: 'attached', timeout: 5_000 }).catch(() => undefined);
}
