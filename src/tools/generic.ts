import { z } from 'zod';
import { getPage, isSessionExpired, acquirePageLock, extractSidFromUrl } from '../browser/context.js';
import { setFieldByLabel, findButton, getValidationErrors, getPageTitle, type FieldResult } from '../browser/forms.js';
import { waitForPageReady } from '../browser/wait.js';
import { guardPage, isPaymentField, isDangerousButton } from '../security/guards.js';
import { sessionExpiredResult } from './session.js';

const fieldKind = z.enum(['auto', 'text', 'select', 'radio', 'checkbox']);

export const fillFieldsSchema = z.object({
  fields: z
    .array(
      z.object({
        label: z.string().min(1).describe('Accessible label of the field, as shown by read_current_page. For a radio option, the option text.'),
        value: z.string().describe('Value to enter. For checkbox or radio use "true"/"false".'),
        kind: fieldKind.optional().describe('Field kind. Defaults to "auto", which detects the element type.'),
      }),
    )
    .min(1),
});

export async function fillFields(input: z.infer<typeof fillFieldsSchema>): Promise<Record<string, unknown>> {
  const release = await acquirePageLock();
  try {
    const page = await getPage();
    if (await isSessionExpired()) return sessionExpiredResult;

    const guard = await guardPage(page);
    if (guard.refused) {
      return { success: false, error: 'refused_filing_page', title: guard.title, message: 'Filing and payment pages must be completed by the user in the browser.' };
    }
    const paymentLabel = input.fields.find(f => isPaymentField(f.label));
    if (paymentLabel) {
      return { success: false, error: 'refused_payment_field', label: paymentLabel.label, message: 'Card details are never entered through this tool.' };
    }

    const results: Array<FieldResult & { label: string }> = [];
    for (const f of input.fields) {
      results.push({ label: f.label, ...(await setFieldByLabel(page, f.label, f.value, f.kind ?? 'auto')) });
    }

    const failed = results.filter(r => !r.ok).map(r => r.label);
    if (failed.length === input.fields.length) {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 15_000 }).catch(() => undefined);
      await waitForPageReady(page);
      if (await isSessionExpired()) return sessionExpiredResult;
    }

    return {
      success: failed.length === 0,
      pageTitle: await getPageTitle(page),
      sid: extractSidFromUrl(page.url()),
      results,
      failed,
      validationErrors: await getValidationErrors(page),
      hint:
        failed.length > 0
          ? 'Call read_current_page to see exact labels, then retry with kind set explicitly.'
          : 'Fields set but not yet saved. Call save_and_continue to submit the page.',
    };
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
    if (await isSessionExpired()) return sessionExpiredResult;

    const guard = await guardPage(page);
    if (guard.refused) {
      return { success: false, error: 'refused_filing_page', title: guard.title, message: 'Filing and payment pages must be completed by the user in the browser.' };
    }
    if (isDangerousButton(input.name)) {
      return { success: false, error: 'refused_button', name: input.name, message: 'Filing, purchase and payment actions must be done by the user in the browser.' };
    }

    const found = await findButton(page, input.name);
    if (!found.ok) {
      return { success: false, error: found.reason, name: input.name, candidates: found.candidates };
    }
    if (isDangerousButton(found.name)) {
      return { success: false, error: 'refused_button', name: found.name, message: 'Filing, purchase and payment actions must be done by the user in the browser.' };
    }

    try {
      await found.locator.click({ timeout: 3_000 });
    } catch (err) {
      return { success: false, error: 'click_failed', name: found.name, message: err instanceof Error ? err.message.split('\n')[0] : String(err) };
    }
    await waitForPageReady(page);

    return { success: true, clicked: found.name, currentPage: await getPageTitle(page), sid: extractSidFromUrl(page.url()), url: page.url() };
  } finally {
    release();
  }
}
