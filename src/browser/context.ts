import { chromium, type BrowserContext, type Page } from 'playwright';
import { mkdirSync, chmodSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';

const DEFAULT_USER_DATA_DIR = resolve(homedir(), '.freetaxusa-mcp', 'browser-profile');
const TAX_YEAR = process.env.FREETAXUSA_TAX_YEAR ?? '2025';

export const BASE_URL = `https://www.freetaxusa.com/taxes${TAX_YEAR}/taxcontrol`;
export const AUTH_URL = `https://auth.freetaxusa.com/?PRMPT&appYear=${TAX_YEAR}`;
export const AUTH_HOST = 'auth.freetaxusa.com';

let browserContext: BrowserContext | null = null;
let activePage: Page | null = null;
let mutexPromise: Promise<void> = Promise.resolve();

export async function acquirePageLock(): Promise<() => void> {
  const previous = mutexPromise;
  let release: () => void = () => undefined;
  mutexPromise = new Promise<void>(r => {
    release = r;
  });
  await previous;
  return release;
}

export function isHeadless(): boolean {
  return process.env.FREETAXUSA_HEADLESS !== 'false';
}

export function getUserDataDir(): string {
  return process.env.FREETAXUSA_USER_DATA_DIR
    ? resolve(process.env.FREETAXUSA_USER_DATA_DIR.replace('~', homedir()))
    : DEFAULT_USER_DATA_DIR;
}

function ensureUserDataDir(): string {
  const dir = getUserDataDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    chmodSync(dir, 0o700);
  }
  return dir;
}

export async function getBrowserContext(): Promise<BrowserContext> {
  if (browserContext) return browserContext;

  browserContext = await chromium.launchPersistentContext(ensureUserDataDir(), {
    headless: isHeadless(),
    viewport: { width: 1280, height: 800 },
    args: ['--no-first-run', '--no-default-browser-check'],
    ignoreHTTPSErrors: false,
    bypassCSP: false,
  });

  browserContext.on('dialog', dialog => {
    const kind = dialog.type();
    process.stderr.write(`[freetaxusa-mcp] dialog ${kind}: ${dialog.message().slice(0, 80)}\n`);
    const action = kind === 'beforeunload' ? dialog.accept() : dialog.dismiss();
    action.catch(() => undefined);
  });

  return browserContext;
}

export async function getPage(): Promise<Page> {
  const ctx = await getBrowserContext();
  if (activePage && !activePage.isClosed()) return activePage;
  const pages = ctx.pages();
  activePage = pages.length > 0 ? pages[0] : await ctx.newPage();
  return activePage;
}

export async function isSessionExpired(): Promise<boolean> {
  const page = await getPage();
  const url = page.url();
  return url.includes(AUTH_HOST) || url.includes('/login') || url === 'about:blank';
}

export function extractSidFromUrl(url: string): number | null {
  const match = url.match(/[?&]sid=(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

export async function closeBrowser(): Promise<void> {
  if (browserContext) {
    const ctx = browserContext;
    browserContext = null;
    activePage = null;
    await ctx.close().catch(() => undefined);
  }
}
