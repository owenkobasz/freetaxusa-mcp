import { z } from 'zod';
import { getPage, isSessionExpired, acquirePageLock, getCurrentPageId } from '../browser/context.js';
import { setFieldByLabel, findButton, readModal, getValidationErrors, getPageTitle, type FieldResult } from '../browser/forms.js';
import { waitForPageChange } from '../browser/navigation.js';
import { guardPage, isPaymentField, isDangerousButton } from '../security/guards.js';
import { sessionExpiredResult } from './session.js';

const fieldKind = z.enum(['auto', 'text', 'select', 'radio', 'checkbox']);

export const fillFieldsSchema = z.object({
  fields: z
    .array(
      z.object({
        label: z.string().min(1).describe('Field label as shown by read_current_page. For a radio group, the question; the option goes in value.'),
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
    if (await isSessionExpired()) return sessionExpiredResult;

    return {
      success: failed.length === 0,
      pageTitle: await getPageTitle(page),
      pageId: await getCurrentPageId(page),
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

    const before = await page.locator('#taxForm input[name="uniquePageId"]').first().inputValue({ timeout: 1_000 }).catch(() => '');
    try {
      await found.locator.click({ timeout: 3_000 });
    } catch (err) {
      return { success: false, error: 'click_failed', name: found.name, message: err instanceof Error ? err.message.split('\n')[0] : String(err) };
    }
    // Most buttons swap the page over AJAX; a button that only toggles
    // something in place just waits out the change timeout.
    await waitForPageChange(page, before);
    if (await isSessionExpired()) return sessionExpiredResult;

    const modal = await readModal(page);
    return {
      success: true,
      clicked: found.name,
      currentPage: await getPageTitle(page),
      pageId: await getCurrentPageId(page),
      ...(modal ? { modal, hint: 'A dialog opened. Answer it with click_button before doing anything else.' } : {}),
    };
  } finally {
    release();
  }
}
