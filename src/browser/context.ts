import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { mkdirSync, chmodSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { homedir, platform } from 'node:os';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';

const DEFAULT_USER_DATA_DIR = resolve(homedir(), '.freetaxusa-mcp', 'browser-profile');
const TAX_YEAR = process.env.FREETAXUSA_TAX_YEAR ?? '2025';

export const BASE_URL = `https://www.freetaxusa.com/taxes${TAX_YEAR}/taxcontrol`;
export const AUTH_URL = `https://auth.freetaxusa.com/?PRMPT&appYear=${TAX_YEAR}`;
export const AUTH_HOST = 'auth.freetaxusa.com';

let browserContext: BrowserContext | null = null;
let cdpBrowser: Browser | null = null;
let chromeProcess: ChildProcess | null = null;
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

function chromeExecutable(): string {
  if (process.env.FREETAXUSA_CHROME_PATH) return process.env.FREETAXUSA_CHROME_PATH;
  switch (platform()) {
    case 'darwin':
      return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    case 'win32':
      return 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    default:
      return 'google-chrome';
  }
}

function devToolsPortFile(): string {
  return join(getUserDataDir(), 'DevToolsActivePort');
}

async function readCdpEndpoint(): Promise<string | null> {
  const file = devToolsPortFile();
  if (!existsSync(file)) return null;
  const port = readFileSync(file, 'utf8').split('\n')[0].trim();
  if (!/^\d+$/.test(port)) return null;
  const endpoint = `http://127.0.0.1:${port}`;
  try {
    const res = await fetch(`${endpoint}/json/version`, { signal: AbortSignal.timeout(1_000) });
    return res.ok ? endpoint : null;
  } catch {
    return null;
  }
}

/**
 * List open tab URLs over Chrome's HTTP endpoint. Unlike a CDP session this
 * attaches nothing to the page, so it is safe to poll while the user is
 * clearing a bot check.
 */
export async function listChromeTabUrls(): Promise<string[] | null> {
  const endpoint = await readCdpEndpoint();
  if (!endpoint) return null;
  try {
    const res = await fetch(`${endpoint}/json/list`, { signal: AbortSignal.timeout(1_000) });
    const tabs = (await res.json()) as Array<{ type?: string; url?: string }>;
    return tabs.filter(t => t.type === 'page').map(t => t.url ?? '');
  } catch {
    return null;
  }
}

function findChromePid(userDataDir: string): number | null {
  if (chromeProcess?.pid && chromeProcess.exitCode === null) return chromeProcess.pid;
  try {
    const out = execFileSync('pgrep', ['-f', `--user-data-dir=${userDataDir}`], { encoding: 'utf8' });
    const pids = out
      .split('\n')
      .map(s => parseInt(s, 10))
      .filter(n => Number.isFinite(n));
    // The browser process is the parent of the helpers, so it has the lowest pid.
    return pids.length > 0 ? Math.min(...pids) : null;
  } catch {
    return null;
  }
}

export function isChromeRunning(): boolean {
  return findChromePid(getUserDataDir()) !== null;
}

/**
 * Gracefully quit the Chrome running on our profile so it writes cookies and
 * session state to disk, then wait for it to exit.
 */
export async function stopChrome(): Promise<void> {
  const pid = findChromePid(getUserDataDir());
  if (pid === null) return;
  const alive = (): boolean => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    return;
  }
  const deadline = Date.now() + 10_000;
  while (alive() && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 200));
  }
  if (alive()) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // already gone
    }
  }
  chromeProcess = null;
}

/**
 * Start the installed Google Chrome as a plain child process with a debugging
 * port, without attaching Playwright. Reuses a Chrome already running on our
 * profile (including one left by a previous server process). Chrome is spawned
 * detached so it outlives this server: only logout closes it, which is what
 * lets a server restart reattach to a signed-in window. Returns the CDP endpoint.
 */
export async function launchChromeDetached(initialUrl: string): Promise<string> {
  const existing = await readCdpEndpoint();
  if (existing) return existing;
  if (isChromeRunning()) {
    throw new Error('Chrome is running on the profile without a debugging port; quit it and retry.');
  }

  const userDataDir = ensureUserDataDir();
  rmSync(devToolsPortFile(), { force: true });
  chromeProcess = spawn(
    chromeExecutable(),
    [
      `--user-data-dir=${userDataDir}`,
      '--remote-debugging-port=0',
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1280,900',
      initialUrl,
    ],
    { stdio: 'ignore', detached: true },
  );
  chromeProcess.unref();
  chromeProcess.on('exit', () => {
    chromeProcess = null;
  });

  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const endpoint = await readCdpEndpoint();
    if (endpoint) return endpoint;
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error(`Chrome did not expose a debugging port within 20s (${chromeExecutable()})`);
}

async function attachToChrome(): Promise<BrowserContext> {
  const endpoint = await launchChromeDetached(AUTH_URL);
  cdpBrowser = await chromium.connectOverCDP(endpoint);
  const contexts = cdpBrowser.contexts();
  return contexts.length > 0 ? contexts[0] : await cdpBrowser.newContext();
}

export function isAttached(): boolean {
  return browserContext !== null;
}

export async function getBrowserContext(): Promise<BrowserContext> {
  if (browserContext) return browserContext;

  if (isHeadless()) {
    browserContext = await chromium.launchPersistentContext(ensureUserDataDir(), {
      headless: true,
      viewport: { width: 1280, height: 800 },
      args: ['--no-first-run', '--no-default-browser-check'],
      ignoreHTTPSErrors: false,
      bypassCSP: false,
    });
  } else {
    browserContext = await attachToChrome();
  }

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
  activePage =
    pages.find(p => p.url().includes('freetaxusa.com')) ?? (pages.length > 0 ? pages[0] : await ctx.newPage());
  return activePage;
}

/**
 * The tax app is one URL (taxcontrol?sid=12) whose pages load over AJAX, so the
 * URL says nothing about the page. The hidden fp input of #taxForm holds the
 * current page id, and the form itself is only present while signed in.
 */
export async function getCurrentPageId(page: Page): Promise<number | null> {
  const value = await page
    .locator('#taxForm input[name="fp"]')
    .first()
    .inputValue({ timeout: 1_000 })
    .catch(() => '');
  return /^\d+$/.test(value) ? parseInt(value, 10) : null;
}

/** Signed-in check that never navigates: a bare GET of the tax app ends the session. */
export async function isSessionExpired(): Promise<boolean> {
  const page = await getPage();
  const url = page.url();
  if (url.includes(AUTH_HOST) || url === 'about:blank' || !url.includes('www.freetaxusa.com')) return true;
  return (await page.locator('#taxForm').count().catch(() => 0)) === 0;
}

/** Detach Playwright but leave Chrome running. */
export async function detachBrowser(): Promise<void> {
  const ctx = browserContext;
  const browser = cdpBrowser;
  browserContext = null;
  cdpBrowser = null;
  activePage = null;

  if (browser) {
    await browser.close().catch(() => undefined);
  } else if (ctx) {
    await ctx.close().catch(() => undefined);
  }
}

export async function closeBrowser(): Promise<void> {
  await detachBrowser();
  await stopChrome();
}

process.on('exit', () => {
  if (chromeProcess && chromeProcess.exitCode === null) chromeProcess.kill();
});
