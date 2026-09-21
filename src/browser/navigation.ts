import { type Page } from 'playwright';
import { getPage, BASE_URL, extractSidFromUrl, isSessionExpired } from './context.js';
import { getPageTitle } from './forms.js';
import { waitForPageReady } from './wait.js';
import { type SidMap, type SidResolution, resolveSidFromMap } from '../types/sections.js';

let cachedSidMap: SidMap | null = null;
const SID_CACHE_TTL_MS = 300_000;

export async function discoverSidMap(page: Page, force = false): Promise<SidMap> {
  if (!force && cachedSidMap && Date.now() - cachedSidMap.discoveredAt < SID_CACHE_TTL_MS) {
    return cachedSidMap;
  }

  const byName = new Map<string, number>();
  const bySid = new Map<number, string>();

  const links = await page
    .evaluate(() =>
      Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="sid="]')).map(a => ({
        text: a.textContent?.trim() ?? '',
        href: a.getAttribute('href') ?? '',
      })),
    )
    .catch(() => []);

  for (const link of links) {
    const match = link.href.match(/sid=(\d+)/);
    if (!match || !link.text) continue;
    const sid = parseInt(match[1], 10);
    byName.set(link.text.toLowerCase(), sid);
    if (!bySid.has(sid)) bySid.set(sid, link.text);
  }

  cachedSidMap = { byName, bySid, discoveredAt: Date.now() };
  return cachedSidMap;
}

export async function countSidLinks(page: Page): Promise<number> {
  return page.locator('a[href*="sid="]').count().catch(() => 0);
}

export async function resolveSid(section?: string, sid?: number): Promise<SidResolution> {
  if (sid !== undefined) return { sid };
  if (!section) return null;
  const map = await discoverSidMap(await getPage());
  return resolveSidFromMap(map, section);
}

export async function navigateToSid(sid: number): Promise<{ title: string; sid: number; url: string }> {
  const page = await getPage();
  await page.goto(`${BASE_URL}?sid=${sid}`, { waitUntil: 'domcontentloaded', timeout: 15_000 });
  await waitForPageReady(page);
  if (await isSessionExpired()) throw new Error('SESSION_EXPIRED');
  return { title: await getPageTitle(page), sid: extractSidFromUrl(page.url()) ?? sid, url: page.url() };
}

export async function assertPage(page: Page, expected: RegExp | string): Promise<{ ok: boolean; actualTitle: string }> {
  const actualTitle = await getPageTitle(page);
  const ok = typeof expected === 'string' ? actualTitle.toLowerCase().includes(expected.toLowerCase()) : expected.test(actualTitle);
  return { ok, actualTitle };
}

export function clearSidMapCache(): void {
  cachedSidMap = null;
}
