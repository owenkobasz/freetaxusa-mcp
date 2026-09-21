import { type Locator, type Page } from 'playwright';
import { type FormField } from '../types/tax.js';
import { waitForPageReady } from './wait.js';

export type FieldKind = 'auto' | 'text' | 'select' | 'radio' | 'checkbox';

export interface FieldResult {
  ok: boolean;
  matchedLabel?: string;
  via?: Exclude<FieldKind, 'auto'>;
  reason?: string;
  candidates?: string[];
}

export type LabelResolution =
  | { ok: true; locator: Locator; matchedLabel: string }
  | { ok: false; reason: 'not_found' | 'ambiguous'; candidates: string[] };

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message.split('\n')[0] : String(err);
}

export async function readFormFields(page: Page): Promise<FormField[]> {
  return page.evaluate(() => {
    const fields: FormField[] = [];

    function isShown(el: Element): boolean {
      return el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
    }

    function labelFor(el: HTMLElement): string {
      const ariaLabel = el.getAttribute('aria-label');
      if (ariaLabel) return ariaLabel;
      const id = el.getAttribute('id');
      if (id) {
        const label = document.querySelector(`label[for="${id}"]`);
        if (label?.textContent?.trim()) return label.textContent.trim();
      }
      const parentLabel = el.closest('label');
      if (parentLabel?.textContent?.trim()) return parentLabel.textContent.trim();
      const labelledBy = el.getAttribute('aria-labelledby');
      if (labelledBy) {
        const labelEl = document.getElementById(labelledBy);
        if (labelEl?.textContent?.trim()) return labelEl.textContent.trim();
      }
      return el.getAttribute('name') || el.getAttribute('placeholder') || '';
    }

    function groupLabel(first: HTMLInputElement, name: string): string {
      const legend = first.closest('fieldset')?.querySelector('legend');
      if (legend?.textContent?.trim()) return legend.textContent.trim();
      let node: Element | null = first.closest('fieldset, div, tr, li, p') ?? first;
      for (let i = 0; i < 6 && node; i++) {
        const prev: Element | null = node.previousElementSibling;
        if (prev) {
          if (/^(H[1-6]|LABEL|LEGEND|P)$/.test(prev.tagName)) {
            const text = prev.textContent?.trim();
            if (text) return text.slice(0, 120);
          }
          node = prev;
        } else {
          node = node.parentElement;
        }
      }
      return name;
    }

    const textInputs = document.querySelectorAll<HTMLInputElement>(
      'input[type="text"], input[type="email"], input[type="tel"], input[type="number"], input:not([type]), textarea',
    );
    for (const el of textInputs) {
      if (!isShown(el)) continue;
      fields.push({
        label: labelFor(el),
        value: el.value ?? '',
        type: el.type === 'number' ? 'currency' : 'text',
        required: el.required,
      });
    }

    for (const el of document.querySelectorAll<HTMLSelectElement>('select')) {
      if (!isShown(el)) continue;
      fields.push({
        label: labelFor(el),
        value: el.options[el.selectedIndex]?.text ?? '',
        type: 'select',
        required: el.required,
        options: Array.from(el.options).map(o => o.text),
      });
    }

    const groups = new Map<string, { label: string; value: string; options: string[] }>();
    for (const el of document.querySelectorAll<HTMLInputElement>('input[type="radio"]')) {
      if (!isShown(el)) continue;
      const name = el.getAttribute('name') ?? '';
      let group = groups.get(name);
      if (!group) {
        group = { label: groupLabel(el, name), value: '', options: [] };
        groups.set(name, group);
      }
      const optLabel = labelFor(el);
      group.options.push(optLabel);
      if (el.checked) group.value = optLabel;
    }
    for (const group of groups.values()) {
      fields.push({ label: group.label, value: group.value, type: 'radio', required: false, options: group.options });
    }

    for (const el of document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) {
      if (!isShown(el)) continue;
      fields.push({ label: labelFor(el), value: el.checked ? 'checked' : '', type: 'checkbox', required: el.required });
    }

    return fields;
  });
}

async function describeLabels(locator: Locator): Promise<string[]> {
  return locator.evaluateAll(elements =>
    elements.map(el => {
      const ariaLabel = el.getAttribute('aria-label');
      if (ariaLabel) return ariaLabel;
      const id = el.getAttribute('id');
      const forLabel = id ? document.querySelector(`label[for="${id}"]`)?.textContent?.trim() : '';
      if (forLabel) return forLabel;
      const wrapped = el.closest('label')?.textContent?.trim();
      if (wrapped) return wrapped;
      return el.getAttribute('name') ?? el.tagName.toLowerCase();
    }),
  );
}

export async function resolveLabel(page: Page, label: string): Promise<LabelResolution> {
  const attempts: Locator[] = [
    page.getByLabel(label, { exact: true }),
    page.getByLabel(new RegExp(`^\\s*${escapeRegExp(label)}\\s*[:*]?\\s*$`, 'i')),
    page.getByLabel(label, { exact: false }),
  ];
  for (const locator of attempts) {
    const count = await locator.count();
    if (count === 1) {
      const [matchedLabel] = await describeLabels(locator);
      return { ok: true, locator, matchedLabel };
    }
    if (count > 1) {
      return { ok: false, reason: 'ambiguous', candidates: await describeLabels(locator) };
    }
  }
  return { ok: false, reason: 'not_found', candidates: [] };
}

export async function setFieldByLabel(page: Page, label: string, value: string, kind: FieldKind = 'auto'): Promise<FieldResult> {
  const resolved = await resolveLabel(page, label);
  if (!resolved.ok) return { ok: false, reason: resolved.reason, candidates: resolved.candidates };

  const { locator, matchedLabel } = resolved;
  const info = await locator.evaluate(el => ({
    tag: el.tagName.toLowerCase(),
    type: el instanceof HTMLInputElement ? el.type : '',
  }));
  const detected: Exclude<FieldKind, 'auto'> =
    info.tag === 'select' ? 'select' : info.type === 'checkbox' ? 'checkbox' : info.type === 'radio' ? 'radio' : 'text';
  if (kind !== 'auto' && kind !== detected) {
    return { ok: false, matchedLabel, reason: `field is ${detected}, not ${kind}` };
  }

  try {
    await locator.waitFor({ state: 'visible', timeout: 1_000 });
    switch (detected) {
      case 'select':
        try {
          await locator.selectOption({ label: value }, { timeout: 1_000 });
        } catch {
          await locator.selectOption({ value }, { timeout: 1_000 });
        }
        break;
      case 'checkbox':
        await locator.setChecked(/^(true|yes|1|checked|on)$/i.test(value), { timeout: 1_000 });
        break;
      case 'radio':
        await locator.check({ timeout: 1_000 });
        break;
      default:
        await locator.fill(value, { timeout: 1_000 });
    }
    return { ok: true, matchedLabel, via: detected };
  } catch (err) {
    return { ok: false, matchedLabel, via: detected, reason: errorMessage(err) };
  }
}

export type ButtonResolution =
  | { ok: true; locator: Locator; name: string }
  | { ok: false; reason: 'not_found' | 'ambiguous'; candidates: string[] };

export async function findButton(page: Page, name: string): Promise<ButtonResolution> {
  const exact = page.getByRole('button', { name, exact: true }).or(page.getByRole('link', { name, exact: true }));
  let target = exact;
  let count = await exact.count();
  if (count === 0) {
    const pattern = new RegExp(`\\b${escapeRegExp(name)}\\b`, 'i');
    target = page.getByRole('button', { name: pattern }).or(page.getByRole('link', { name: pattern }));
    count = await target.count();
  }
  if (count === 0) return { ok: false, reason: 'not_found', candidates: [] };
  const names = (await target.allInnerTexts()).map(t => t.trim());
  if (count > 1) return { ok: false, reason: 'ambiguous', candidates: names };
  return { ok: true, locator: target.first(), name: names[0] || name };
}

export async function clickSaveAndContinue(page: Page): Promise<string[]> {
  const button = page
    .getByRole('button', { name: /save and continue/i })
    .or(page.getByRole('button', { name: /^continue$/i }))
    .or(page.locator('input[type="submit"][value*="Continue" i]'))
    .first();
  try {
    await button.click({ timeout: 3_000 });
  } catch {
    return ['Could not find Save and Continue button'];
  }
  await waitForPageReady(page);
  return getValidationErrors(page);
}

export async function getValidationErrors(page: Page): Promise<string[]> {
  const errors: string[] = [];
  const candidates = page.locator('.error, .err, [class*="error"], [role="alert"]');
  const count = Math.min(await candidates.count().catch(() => 0), 20);
  for (let i = 0; i < count; i++) {
    const el = candidates.nth(i);
    if (!(await el.isVisible().catch(() => false))) continue;
    const text = (await el.innerText().catch(() => '')).trim();
    if (text && !errors.includes(text)) errors.push(text);
  }
  return errors;
}

export async function getPageTitle(page: Page): Promise<string> {
  const h1 = await page.locator('h1').first().innerText({ timeout: 1_000 }).catch(() => '');
  if (h1.trim()) return h1.trim();
  return page.title();
}
