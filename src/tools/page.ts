import { z } from 'zod';
import { getPage, isSessionExpired, extractSidFromUrl, acquirePageLock } from '../browser/context.js';
import { readFormFields, clickSaveAndContinue, getPageTitle } from '../browser/forms.js';
import { resolveSid, navigateToSid, discoverSidMap, assertPage } from '../browser/navigation.js';
import { waitForPageReady } from '../browser/wait.js';
import { guardPage } from '../security/guards.js';
import { sessionExpiredResult } from './session.js';

export const readCurrentPageSchema = z.object({});

export async function readCurrentPage(): Promise<Record<string, unknown>> {
  const release = await acquirePageLock();
  try {
    const page = await getPage();
    if (await isSessionExpired()) return sessionExpiredResult;
    const url = page.url();
    return {
      success: true,
      pageTitle: await getPageTitle(page),
      sid: extractSidFromUrl(url),
      url,
      fields: await readFormFields(page),
    };
  } finally {
    release();
  }
}

export const saveAndContinueSchema = z.object({});

export async function saveAndContinue(): Promise<Record<string, unknown>> {
  const release = await acquirePageLock();
  try {
    const page = await getPage();
    if (await isSessionExpired()) return sessionExpiredResult;

    const guard = await guardPage(page);
    if (guard.refused) {
      return { success: false, error: 'refused_filing_page', title: guard.title, message: 'Filing and payment pages must be completed by the user in the browser.' };
    }

    const errors = await clickSaveAndContinue(page);
    await waitForPageReady(page);
    const title = await getPageTitle(page);
    const sid = extractSidFromUrl(page.url());

    if (errors.length > 0) return { success: false, errors, currentPage: title, currentSid: sid };
    return { success: true, nextPage: title, nextSid: sid };
  } finally {
    release();
  }
}

export const navigateSectionSchema = z
  .object({
    section: z.string().optional().describe('Section name (e.g., "income", "deductions", "personal info")'),
    sid: z.number().optional().describe('Direct SID number to navigate to'),
  })
  .refine(data => data.section !== undefined || data.sid !== undefined, {
    message: 'Either section name or sid must be provided',
  });

export async function navigateSection(input: z.infer<typeof navigateSectionSchema>): Promise<Record<string, unknown>> {
  const release = await acquirePageLock();
  try {
    if (await isSessionExpired()) return sessionExpiredResult;

    const resolved = await resolveSid(input.section, input.sid);
    if (resolved === null) {
      return { success: false, error: 'section_not_found', message: `Could not resolve section "${input.section}". Call list_sections to see available names.` };
    }
    if ('ambiguous' in resolved) {
      return { success: false, error: 'section_ambiguous', candidates: resolved.ambiguous };
    }

    try {
      const result = await navigateToSid(resolved.sid);
      return { success: true, currentPage: result.title, sid: result.sid, url: result.url };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message === 'SESSION_EXPIRED') return sessionExpiredResult;
      return { success: false, error: 'navigation_failed', message };
    }
  } finally {
    release();
  }
}

export const expectPageSchema = z.object({
  titleContains: z.string().min(1).describe('Text the page heading or title must contain (case-insensitive)'),
});

export async function expectPage(input: z.infer<typeof expectPageSchema>): Promise<Record<string, unknown>> {
  const release = await acquirePageLock();
  try {
    const page = await getPage();
    if (await isSessionExpired()) return sessionExpiredResult;
    const result = await assertPage(page, input.titleContains);
    return { success: true, ok: result.ok, actualTitle: result.actualTitle, sid: extractSidFromUrl(page.url()) };
  } finally {
    release();
  }
}

export const listSectionsSchema = z.object({
  refresh: z.boolean().optional().describe('Re-scan the sidebar instead of using the cached map'),
});

export async function listSections(input: z.infer<typeof listSectionsSchema>): Promise<Record<string, unknown>> {
  const release = await acquirePageLock();
  try {
    const page = await getPage();
    if (await isSessionExpired()) return sessionExpiredResult;
    const before = Date.now();
    const map = await discoverSidMap(page, input.refresh ?? false);
    const sections = Array.from(map.bySid.entries())
      .map(([sid, name]) => ({ sid, name }))
      .sort((a, b) => a.sid - b.sid);
    return { success: true, sections, discoveredAt: new Date(map.discoveredAt).toISOString(), fromCache: map.discoveredAt < before };
  } finally {
    release();
  }
}
