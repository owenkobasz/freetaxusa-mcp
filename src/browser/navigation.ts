import { type Page } from 'playwright';
import { getPage, getCurrentPageId, isSessionExpired } from './context.js';
import { getPageTitle } from './forms.js';
import { waitForPageReady } from './wait.js';
import { type SectionMap, type SectionItem, type SidResolution, resolveSidFromMap } from '../types/sections.js';

let cachedMap: SectionMap | null = null;
const SECTION_CACHE_TTL_MS = 300_000;
const NAV_TIMEOUT_MS = 20_000;

/**
 * The sidebar is a row of Bootstrap dropdowns. Each group's wrapper carries the
 * page id of its first page in its class (`btn-group menu-item-200`), and the
 * dropdown holds the group's sub-pages as buttons bound by random element ids,
 * so sub-pages can only be reached by clicking them.
 */
export async function discoverSections(page: Page, force = false): Promise<SectionMap> {
  if (!force && cachedMap && Date.now() - cachedMap.discoveredAt < SECTION_CACHE_TTL_MS) {
    return cachedMap;
  }

  const groups = await page
    .evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>('.btn-group[class*="menu-item-"]')).map(group => {
        const pageId = group.className.match(/menu-item-(\d+)/)?.[1];
        const name = group.querySelector('button')?.innerText.replace(/\s+/g, ' ').trim() ?? '';
        const items = Array.from(group.querySelectorAll<HTMLElement>('.dropdown-menu button, .dropdown-menu a')).map(item => {
          const raw = item.innerText.replace(/\s+/g, ' ').trim();
          const inactive = /inactive link/i.test(raw) || item.classList.contains('disabled') || !item.id;
          return { name: raw.replace(/^-?\s*inactive link\s*/i, '').trim(), disabled: inactive };
        });
        return { name, pageId: pageId ? parseInt(pageId, 10) : null, items };
      }),
    )
    .catch(() => []);

  const byName = new Map<string, number>();
  const bySid = new Map<number, string>();
  const items: SectionItem[] = [];
  for (const group of groups) {
    if (!group.name) continue;
    if (group.pageId !== null) {
      byName.set(group.name.toLowerCase(), group.pageId);
      if (!bySid.has(group.pageId)) bySid.set(group.pageId, group.name);
    }
    for (const item of group.items) {
      if (item.name) items.push({ name: item.name, group: group.name, disabled: item.disabled });
    }
  }

  cachedMap = { byName, bySid, items, discoveredAt: Date.now() };
  return cachedMap;
}

export async function resolveSid(section?: string, sid?: number): Promise<SidResolution> {
  if (sid !== undefined) return { sid };
  if (!section) return null;
  const map = await discoverSections(await getPage());
  return resolveSidFromMap(map, section);
}

async function uniquePageToken(page: Page): Promise<string> {
  return page
    .locator('#taxForm input[name="uniquePageId"]')
    .first()
    .inputValue({ timeout: 1_000 })
    .catch(() => '');
}

/** Wait for the AJAX page swap that every navigation and submit performs. */
export async function waitForPageChange(page: Page, previousToken: string): Promise<void> {
  await page
    .waitForFunction(
      prev => {
        const input = document.querySelector<HTMLInputElement>('#taxForm input[name="uniquePageId"]');
        return !input || input.value !== prev;
      },
      previousToken,
      { timeout: NAV_TIMEOUT_MS },
    )
    .catch(() => undefined);
  await waitForPageReady(page);
}

export interface NavResult {
  title: string;
  pageId: number | null;
  url: string;
}

async function describe(page: Page): Promise<NavResult> {
  return { title: await getPageTitle(page), pageId: await getCurrentPageId(page), url: page.url() };
}

/**
 * Go to a page by id through the app's own top-nav submit. A plain GET of
 * taxcontrol?sid=N is not a navigation here: the server treats it as an
 * invalid request and ends the session.
 */
export async function navigateToSid(pageId: number): Promise<NavResult> {
  const page = await getPage();
  const before = await uniquePageToken(page);
  const ok = await page
    .evaluate(id => {
      const nav = (window as unknown as { submitTopNavForm?: (to: string) => boolean }).submitTopNavForm;
      if (typeof nav !== 'function') return false;
      nav(String(id));
      return true;
    }, pageId)
    .catch(() => false);
  if (!ok) throw new Error('NAV_UNAVAILABLE');
  await waitForPageChange(page, before);
  if (await isSessionExpired()) throw new Error('SESSION_EXPIRED');
  return describe(page);
}

/** Open a sidebar group's dropdown and click one of its sub-pages. */
export async function navigateToItem(item: SectionItem): Promise<NavResult> {
  const page = await getPage();
  if (item.disabled) throw new Error('ITEM_INACTIVE');
  const before = await uniquePageToken(page);
  const group = page.locator('.btn-group[class*="menu-item-"]').filter({ has: page.locator(':scope > button', { hasText: item.group }) }).first();
  await group.locator(':scope > button').first().click({ timeout: 3_000 });
  await group.locator('.dropdown-menu button, .dropdown-menu a').filter({ hasText: item.name }).first().click({ timeout: 3_000 });
  await waitForPageChange(page, before);
  if (await isSessionExpired()) throw new Error('SESSION_EXPIRED');
  return describe(page);
}

export async function assertPage(page: Page, expected: RegExp | string): Promise<{ ok: boolean; actualTitle: string }> {
  const actualTitle = await getPageTitle(page);
  const ok = typeof expected === 'string' ? actualTitle.toLowerCase().includes(expected.toLowerCase()) : expected.test(actualTitle);
  return { ok, actualTitle };
}

export function clearSidMapCache(): void {
  cachedMap = null;
}

// Kept for callers that only need the map.
export const discoverSidMap = discoverSections;
