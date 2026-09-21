import { z } from 'zod';
import { getPage, isSessionExpired, getCurrentPageId, acquirePageLock } from '../browser/context.js';
import { readFormFields, readPageOutline, readModal, clickSaveAndContinue, getValidationErrors, getPageTitle } from '../browser/forms.js';
import { resolveSid, navigateToSid, navigateToItem, discoverSections, assertPage, waitForPageChange } from '../browser/navigation.js';
import { guardPage } from '../security/guards.js';
import { sessionExpiredResult } from './session.js';

export const readCurrentPageSchema = z.object({});

export async function readCurrentPage(): Promise<Record<string, unknown>> {
  const release = await acquirePageLock();
  try {
    const page = await getPage();
    if (await isSessionExpired()) return sessionExpiredResult;
    const modal = await readModal(page);
    return {
      success: true,
      pageTitle: await getPageTitle(page),
      pageId: await getCurrentPageId(page),
      ...(modal ? { modal, hint: 'A dialog is open over the page. click_button acts on its buttons until it closes.' } : {}),
      ...(await readPageOutline(page)),
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

    const before = await page.locator('#taxForm input[name="uniquePageId"]').first().inputValue({ timeout: 1_000 }).catch(() => '');
    const beforeId = await getCurrentPageId(page);
    if (!(await clickSaveAndContinue(page))) {
      return { success: false, error: 'no_continue_button', currentPage: await getPageTitle(page), pageId: beforeId };
    }
    await waitForPageChange(page, before);
    if (await isSessionExpired()) return sessionExpiredResult;
    const title = await getPageTitle(page);
    const pageId = await getCurrentPageId(page);
    const errors = await getValidationErrors(page);

    if (errors.length > 0) return { success: false, errors, currentPage: title, pageId };
    if (pageId === beforeId) return { success: false, error: 'page_unchanged', currentPage: title, pageId, message: 'The page did not advance. Call read_current_page to look for what is missing.' };
    return { success: true, nextPage: title, pageId };
  } finally {
    release();
  }
}

export const navigateSectionSchema = z
  .object({
    section: z.string().optional().describe('Section or sub-page name from list_sections (e.g., "income", "Taxpayer Information")'),
    sid: z.number().optional().describe('Page id from list_sections'),
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
      const result = 'item' in resolved ? await navigateToItem(resolved.item) : await navigateToSid(resolved.sid);
      return { success: true, currentPage: result.title, pageId: result.pageId };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message === 'SESSION_EXPIRED') return sessionExpiredResult;
      if (message === 'ITEM_INACTIVE') {
        return { success: false, error: 'section_inactive', message: 'That page is not available yet; earlier pages must be completed first.' };
      }
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
    return { success: true, ok: result.ok, actualTitle: result.actualTitle, pageId: await getCurrentPageId(page) };
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
    const map = await discoverSections(page, input.refresh ?? false);
    const sections = Array.from(map.bySid.entries()).map(([pageId, name]) => ({
      name,
      pageId,
      pages: map.items.filter(i => i.group === name).map(i => (i.disabled ? `${i.name} (not yet available)` : i.name)),
    }));
    return { success: true, sections, discoveredAt: new Date(map.discoveredAt).toISOString(), fromCache: map.discoveredAt < before };
  } finally {
    release();
  }
}
