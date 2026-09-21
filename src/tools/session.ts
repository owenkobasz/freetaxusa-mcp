import { z } from 'zod';
import { rmSync } from 'node:fs';
import {
  getPage,
  isSessionExpired,
  getCurrentPageId,
  AUTH_URL,
  AUTH_HOST,
  acquirePageLock,
  isHeadless,
  closeBrowser,
  getUserDataDir,
  isAttached,
  launchChromeDetached,
  listChromeTabUrls,
} from '../browser/context.js';
import { discoverSections, clearSidMapCache, waitForPageChange } from '../browser/navigation.js';
import { getPageTitle } from '../browser/forms.js';
import { waitForPageReady } from '../browser/wait.js';
import type { SessionStatus } from '../types/tax.js';

const LOGIN_POLL_MS = 2_000;
const LOGIN_WAIT_MS = 90_000;
const LOGIN_ACTION = 'Call login_manual to sign in.';

export const sessionExpiredResult = { success: false, error: 'session_expired', action: LOGIN_ACTION };

function taxYear(): string {
  return process.env.FREETAXUSA_TAX_YEAR ?? '2025';
}

async function tabOnTaxApp(): Promise<boolean> {
  const urls = await listChromeTabUrls();
  if (urls === null) throw new Error('Lost contact with the Chrome debugging port. Did the window close?');
  return urls.some(u => u.includes('www.freetaxusa.com/taxes') && !u.includes(AUTH_HOST));
}

async function authenticatedResult(): Promise<Record<string, unknown>> {
  const page = await getPage();
  const sections = await discoverSections(page, true);
  return {
    success: true,
    authenticated: true,
    taxYear: taxYear(),
    currentPage: await getPageTitle(page),
    pageId: await getCurrentPageId(page),
    sections: [...sections.bySid.entries()].map(([pageId, name]) => ({ name, pageId })),
  };
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
    // Nothing is attached to the page while the user signs in: Cloudflare's
    // interstitial fails with a CDP session on the page. Until a tab reaches
    // the tax app we only poll Chrome's HTTP tab list.
    if (!isAttached()) {
      await launchChromeDetached(AUTH_URL);
      const deadline = Date.now() + LOGIN_WAIT_MS;
      while (!(await tabOnTaxApp())) {
        if (Date.now() >= deadline) {
          return {
            success: false,
            authenticated: false,
            status: 'waiting_for_user',
            message: 'Sign in in the Chrome window, then call login_manual again.',
          };
        }
        await new Promise(r => setTimeout(r, LOGIN_POLL_MS));
      }
    }

    // Never navigate here: a bare GET of the tax app ends the session.
    const page = await getPage();
    await waitForPageReady(page);
    if (!(await isSessionExpired())) return authenticatedResult();

    return {
      success: false,
      authenticated: false,
      status: 'not_signed_in',
      currentUrl: page.url(),
      currentTitle: await getPageTitle(page),
      message: 'No signed-in tax app page found. Sign in in the Chrome window, then call login_manual again.',
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

    const status: SessionStatus = {
      active: true,
      taxYear: taxYear(),
      currentSection: await getPageTitle(page),
      currentSid: await getCurrentPageId(page),
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
      // The account menu's Sign Out entry runs submitTopNavForm('70').
      const before = await page.locator('#taxForm input[name="uniquePageId"]').first().inputValue({ timeout: 1_000 }).catch(() => '');
      loggedOut = await page
        .evaluate(() => {
          const nav = (window as unknown as { submitTopNavForm?: (to: string) => boolean }).submitTopNavForm;
          if (typeof nav !== 'function') return false;
          nav('70');
          return true;
        })
        .catch(() => false);
      if (loggedOut) await waitForPageChange(page, before);
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
