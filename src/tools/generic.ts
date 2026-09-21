/**
 * Generic page tools: fill_fields, click_button
 *
 * These let the agent operate any FreeTaxUSA page (W-2, 1099, deductions, ...)
 * by accessible label, without page-specific tools for every form.
 */

import { z } from 'zod';
import { getPage, isSessionExpired, acquirePageLock, extractSidFromUrl } from '../browser/context.js';
import {
  fillFieldByLabel,
  selectByLabel,
  clickRadioByLabel,
  setCheckbox,
  getValidationErrors,
  getPageTitle,
} from '../browser/forms.js';
import { waitForPageReady } from '../browser/navigation.js';
import { filterPII } from '../security/pii-filter.js';

const fieldKind = z.enum(['auto', 'text', 'select', 'radio', 'checkbox']);

export const fillFieldsSchema = z.object({
  fields: z.array(z.object({
    label: z.string().min(1).describe('Accessible label of the field, as shown by read_current_page'),
    value: z.string().describe('Value to enter. For checkbox use "true"/"false". For radio, the option label.'),
    kind: fieldKind.optional().describe('Field kind. Defaults to "auto": try text, then select, then checkbox/radio.'),
  })).min(1),
});

type FieldInput = z.infer<typeof fillFieldsSchema>['fields'][number];

async function fillOne(page: Awaited<ReturnType<typeof getPage>>, f: FieldInput): Promise<{ label: string; ok: boolean; via?: string }> {
  const kind = f.kind ?? 'auto';
  const isBool = /^(true|false)$/i.test(f.value);

  if (kind === 'text' || kind === 'auto') {
    if (await fillFieldByLabel(page, f.label, f.value)) return { label: f.label, ok: true, via: 'text' };
    if (kind === 'text') return { label: f.label, ok: false };
  }
  if (kind === 'select' || kind === 'auto') {
    if (await selectByLabel(page, f.label, f.value)) return { label: f.label, ok: true, via: 'select' };
    if (kind === 'select') return { label: f.label, ok: false };
  }
  if (kind === 'checkbox' || (kind === 'auto' && isBool)) {
    if (await setCheckbox(page, f.label, /^true$/i.test(f.value))) return { label: f.label, ok: true, via: 'checkbox' };
    if (kind === 'checkbox') return { label: f.label, ok: false };
  }
  if (kind === 'radio' || kind === 'auto') {
    // For radio, prefer the value as the option label; fall back to the field label.
    const target = kind === 'radio' && f.value ? f.value : f.label;
    if (await clickRadioByLabel(page, target)) return { label: f.label, ok: true, via: 'radio' };
  }
  return { label: f.label, ok: false };
}

export async function fillFields(input: z.infer<typeof fillFieldsSchema>): Promise<Record<string, unknown>> {
  const release = await acquirePageLock();
  try {
    const page = await getPage();

    if (await isSessionExpired()) {
      return { success: false, error: 'session_expired', action: 'Call authenticate to log in.' };
    }

    const results = [];
    for (const f of input.fields) {
      results.push(await fillOne(page, f));
    }

    const failed = results.filter(r => !r.ok).map(r => r.label);
    const validationErrors = await getValidationErrors(page);

    return filterPII({
      success: failed.length === 0,
      pageTitle: await getPageTitle(page),
      sid: extractSidFromUrl(page.url()),
      results,
      failed,
      validationErrors,
      hint: failed.length > 0
        ? 'Call read_current_page to see exact labels, then retry with kind set explicitly.'
        : 'Fields set but not yet saved. Call save_and_continue to submit the page.',
    });
  } finally {
    release();
  }
}

export const clickButtonSchema = z.object({
  name: z.string().min(1).describe('Button or link text, e.g. "Add a W-2", "Edit", "Delete", "Back"'),
});

export async function clickButton(input: z.infer<typeof clickButtonSchema>): Promise<Record<string, unknown>> {
  const release = await acquirePageLock();
  try {
    const page = await getPage();

    if (await isSessionExpired()) {
      return { success: false, error: 'session_expired', action: 'Call authenticate to log in.' };
    }

    // Refuse anything that looks like it submits the return or spends money.
    if (/\b(e-?file|submit (my )?return|transmit|pay now|purchase|buy|checkout)\b/i.test(input.name)) {
      return {
        success: false,
        error: 'refused',
        message: `Refusing to click "${input.name}". Filing and purchase actions must be done by the user in the browser.`,
      };
    }

    const pattern = new RegExp(input.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const target = page.getByRole('button', { name: pattern }).or(page.getByRole('link', { name: pattern })).first();

    try {
      await target.waitFor({ state: 'visible', timeout: 5_000 });
      await target.click();
    } catch {
      return filterPII({ success: false, error: 'not_found', message: `No visible button or link matching "${input.name}".` });
    }

    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
    await waitForPageReady(page);

    return filterPII({
      success: true,
      clicked: input.name,
      currentPage: await getPageTitle(page),
      sid: extractSidFromUrl(page.url()),
      url: page.url(),
    });
  } finally {
    release();
  }
}
