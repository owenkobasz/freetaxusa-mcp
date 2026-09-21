import { z } from 'zod';
import { rmSync } from 'node:fs';
import {
  getPage,
  isSessionExpired,
  extractSidFromUrl,
  AUTH_URL,
  AUTH_HOST,
  BASE_URL,
  acquirePageLock,
  isHeadless,
  closeBrowser,
  getUserDataDir,
} from '../browser/context.js';
import { discoverSidMap, countSidLinks, clearSidMapCache } from '../browser/navigation.js';
import { waitForPageReady } from '../browser/wait.js';
import { getPageTitle } from '../browser/forms.js';
import type { SessionStatus } from '../types/tax.js';

const LOGIN_POLL_MS = 2_000;
const LOGIN_WAIT_MS = 90_000;
const LOGIN_ACTION = 'Call login_manual to sign in.';

export const sessionExpiredResult = { success: false, error: 'session_expired', action: LOGIN_ACTION };

function taxYear(): string {
  return process.env.FREETAXUSA_TAX_YEAR ?? '2025';
}

async function hasLiveSession(): Promise<boolean> {
  const page = await getPage();
  if (page.url().includes(AUTH_HOST)) return false;
  return (await countSidLinks(page)) > 0;
}

export const loginManualSchema = z.object({});

export async function loginManual(): Promise<Record<string, unknown>> {
  if (isHeadless()) {
    return {
      success: false,
      error: 'headless_not_supported',
      message: 'Manual login needs a visible browser. Start the server with FREETAXUSA_HEADLESS=false.',
    };
  }

  const release = await acquirePageLock();
  try {
    const page = await getPage();
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 20_000 }).catch(() => undefined);
    await waitForPageReady(page);

    if (await hasLiveSession()) {
      await discoverSidMap(page, true);
      const landingUrl = page.url();
      return {
        success: true,
        authenticated: true,
        reason: 'already_authenticated',
        taxYear: taxYear(),
        landingUrl,
        urlMatchesBase: landingUrl.startsWith(BASE_URL),
      };
    }

    if (!page.url().includes(AUTH_HOST)) {
      await page.goto(AUTH_URL, { waitUntil: 'domcontentloaded', timeout: 20_000 }).catch(() => undefined);
    }

    const deadline = Date.now() + LOGIN_WAIT_MS;
    while (Date.now() < deadline) {
      await page.waitForTimeout(LOGIN_POLL_MS);
      if (await hasLiveSession()) {
        await discoverSidMap(page, true);
        const landingUrl = page.url();
        return {
          success: true,
          authenticated: true,
          taxYear: taxYear(),
          landingUrl,
          urlMatchesBase: landingUrl.startsWith(BASE_URL),
        };
      }
    }

    return {
      success: false,
      authenticated: false,
      status: 'waiting_for_user',
      message: 'Finish signing in in the browser window, then call login_manual again.',
    };
  } finally {
    release();
  }
}

export const getSessionStatusSchema = z.object({});

export async function getSessionStatus(): Promise<Record<string, unknown>> {
  const release = await acquirePageLock();
  try {
    const page = await getPage();
    if (await isSessionExpired()) {
      const status: SessionStatus = { active: false, taxYear: null, currentSection: null, currentSid: null };
      return { ...status, message: 'No active session. ' + LOGIN_ACTION };
    }

    const sid = extractSidFromUrl(page.url());
    const sidMap = await discoverSidMap(page);
    const status: SessionStatus = {
      active: true,
      taxYear: taxYear(),
      currentSection: (sid !== null ? sidMap.bySid.get(sid) : undefined) ?? (await getPageTitle(page)),
      currentSid: sid,
    };
    return { ...status };
  } finally {
    release();
  }
}

export const logoutSchema = z.object({
  wipeProfile: z.boolean().optional().describe('Delete the saved browser profile and cookies. Defaults to true.'),
});

export async function logout(input: z.infer<typeof logoutSchema>): Promise<Record<string, unknown>> {
  const wipeProfile = input.wipeProfile ?? true;
  const release = await acquirePageLock();
  try {
    let loggedOut = false;
    const page = await getPage();
    if (!(await isSessionExpired())) {
      const signOut = page
        .getByRole('link', { name: /sign out|log out|logout/i })
        .or(page.getByRole('button', { name: /sign out|log out|logout/i }))
        .first();
      loggedOut = await signOut
        .click({ timeout: 3_000 })
        .then(() => true)
        .catch(() => false);
      if (loggedOut) await waitForPageReady(page);
    }

    await closeBrowser();
    clearSidMapCache();

    let profileDeleted = false;
    if (wipeProfile) {
      const dir = getUserDataDir();
      try {
        rmSync(dir, { recursive: true, force: true });
        profileDeleted = true;
      } catch {
        await new Promise(r => setTimeout(r, 1_000));
        rmSync(dir, { recursive: true, force: true });
        profileDeleted = true;
      }
    }

    return { success: true, loggedOut, profileDeleted };
  } finally {
    release();
  }
}
