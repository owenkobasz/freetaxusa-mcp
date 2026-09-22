import { type Frame, type Locator, type Page } from 'playwright';
import { type FormField } from '../types/tax.js';

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

export interface PageOutline {
  headings: string[];
  buttons: string[];
  links: string[];
}

/** Visible headings, buttons and links, so pages without form fields can be driven. */
export async function readPageOutline(page: Page): Promise<PageOutline> {
  return page.evaluate(() => {
    function isShown(el: Element): boolean {
      return el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
    }
    function texts(selector: string, limit: number): string[] {
      const seen = new Set<string>();
      for (const el of document.querySelectorAll<HTMLElement>(selector)) {
        if (!isShown(el)) continue;
        const text = (el.getAttribute('aria-label') || (el as HTMLInputElement).value || el.innerText || '')
          .replace(/\s+/g, ' ')
          .trim();
        if (text && text.length <= 120) seen.add(text);
        if (seen.size >= limit) break;
      }
      return [...seen];
    }
    // Nearest heading above a control, so repeated buttons ("Add" on every
    // income row) can be told apart.
    function contextOf(el: Element): string {
      let node: Element | null = el.parentElement;
      for (let i = 0; i < 8 && node; i++) {
        const heading = Array.from(node.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6, legend, .title')).find(h => !h.contains(el) && isShown(h));
        if (heading) {
          return heading.innerText
            .replace(/open faq window/gi, '')
            .replace(/\s+/g, ' ')
            .trim();
        }
        node = node.parentElement;
      }
      return '';
    }
    function buttons(limit: number): string[] {
      const entries: Array<{ text: string; context: string }> = [];
      for (const el of document.querySelectorAll<HTMLElement>('button, input[type="submit"], input[type="button"], [role="button"]')) {
        if (!isShown(el)) continue;
        const text = (el.getAttribute('aria-label') || (el as HTMLInputElement).value || el.innerText || '').replace(/\s+/g, ' ').trim();
        if (text && text.length <= 120) entries.push({ text, context: contextOf(el) });
      }
      const contextsByText = new Map<string, Set<string>>();
      for (const e of entries) contextsByText.set(e.text, (contextsByText.get(e.text) ?? new Set()).add(e.context));
      const seen = new Set<string>();
      for (const e of entries) {
        const distinct = (contextsByText.get(e.text)?.size ?? 0) > 1;
        seen.add(distinct && e.context ? `${e.text} (${e.context})` : e.text);
        if (seen.size >= limit) break;
      }
      return [...seen];
    }
    return {
      headings: texts('h1, h2, h3', 20),
      buttons: buttons(60),
      links: texts('a[href]', 80),
    };
  });
}

export async function readFormFields(page: Page): Promise<FormField[]> {
  return page.evaluate(() => {
    const fields: FormField[] = [];

    function isShown(el: Element): boolean {
      return el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
    }

    // Label text without the FAQ button FreeTaxUSA nests inside labels, and
    // without the trailing colon.
    function labelText(el: Element | null): string {
      if (!el) return '';
      const clone = el.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('button, a, [role="button"], .visually-hidden, .sr-only').forEach(n => n.remove());
      return (clone.textContent ?? '')
        .replace(/open faq window/gi, '')
        .replace(/\s+/g, ' ')
        .replace(/\s*[:*]\s*$/, '')
        .trim();
    }

    function labelFor(el: HTMLElement): string {
      const ariaLabel = el.getAttribute('aria-label');
      if (ariaLabel) return ariaLabel;
      const id = el.getAttribute('id');
      if (id) {
        const text = labelText(document.querySelector(`label[for="${id}"]`));
        if (text) return text;
      }
      const parentText = labelText(el.closest('label'));
      if (parentText) return parentText;
      const labelledBy = el.getAttribute('aria-labelledby');
      if (labelledBy) {
        const text = labelText(document.getElementById(labelledBy));
        if (text) return text;
      }
      return el.getAttribute('name') || el.getAttribute('placeholder') || '';
    }

    function groupLabel(first: HTMLInputElement, name: string): string {
      const legend = labelText(first.closest('fieldset')?.querySelector('legend') ?? null);
      if (legend) return legend;
      let node: Element | null = first.closest('fieldset, div, tr, li, p') ?? first;
      for (let i = 0; i < 6 && node; i++) {
        const prev: Element | null = node.previousElementSibling;
        if (prev) {
          if (/^(H[1-6]|LABEL|LEGEND|P)$/.test(prev.tagName)) {
            const text = labelText(prev);
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
    const radios = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="radio"]')).filter(isShown);
    const radioNames = new Set(radios.map(r => r.getAttribute('name') ?? ''));
    const pageHeading = labelText(document.querySelector('h1'));
    for (const el of radios) {
      const name = el.getAttribute('name') ?? '';
      let group = groups.get(name);
      if (!group) {
        let label = groupLabel(el, name);
        // A lone group with no label of its own is answering the page heading.
        if (label === name && radioNames.size === 1 && pageHeading) label = pageHeading;
        group = { label, value: '', options: [] };
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
  // Repeatable blocks (extra W-2 states, localities) keep hidden template
  // rows in the DOM with the same labels, so only visible fields count.
  const attempts: Locator[] = [
    page.getByLabel(label, { exact: true }),
    page.getByLabel(new RegExp(`^\\s*${escapeRegExp(label)}\\s*[:*]?\\s*$`, 'i')),
    // Labels as read_current_page reports them, with the nested FAQ button text
    // and trailing colon removed, so match on the label as a prefix.
    page.getByLabel(new RegExp(`^\\s*${escapeRegExp(label)}\\s*[:*]?(\\s*open faq window)?\\s*(\\(|$)`, 'i')),
    page.getByLabel(label, { exact: false }),
  ].map(l => l.filter({ visible: true }));
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

/**
 * Find a radio option by its group's question (as read_current_page reports
 * it) and the option text. Returns the input's id, or null.
 */
async function findRadioInGroup(page: Page, question: string, option: string): Promise<{ id: string | null; groups: string[] }> {
  return page.evaluate(
    ({ question, option }) => {
      const clean = (text: string): string =>
        text
          .replace(/open faq window/gi, '')
          .replace(/\s+/g, ' ')
          .replace(/\s*[:*]\s*$/, '')
          .trim()
          .toLowerCase();
      const labelOf = (el: HTMLInputElement): string => {
        const byFor = el.id ? document.querySelector(`label[for="${el.id}"]`) : null;
        return clean((el.getAttribute('aria-label') || byFor?.textContent || el.closest('label')?.textContent || el.value || '').toString());
      };
      const groupOf = (el: HTMLInputElement): string => {
        const legend = el.closest('fieldset')?.querySelector('legend');
        if (legend?.textContent?.trim()) return clean(legend.textContent);
        let node: Element | null = el.closest('fieldset, div, tr, li, p') ?? el;
        for (let i = 0; i < 6 && node; i++) {
          const prev: Element | null = node.previousElementSibling;
          if (prev) {
            if (/^(H[1-6]|LABEL|LEGEND|P)$/.test(prev.tagName) && prev.textContent?.trim()) return clean(prev.textContent).slice(0, 120);
            node = prev;
          } else {
            node = node.parentElement;
          }
        }
        return clean(el.name);
      };
      const want = clean(question);
      const wantOption = clean(option);
      const groups = new Map<string, HTMLInputElement[]>();
      for (const el of document.querySelectorAll<HTMLInputElement>('input[type="radio"]')) {
        if (el.getClientRects().length === 0) continue;
        const key = groupOf(el);
        groups.set(key, [...(groups.get(key) ?? []), el]);
      }
      // A lone group with no label of its own is answering the page heading.
      if (groups.size === 1) {
        const [key, els] = [...groups.entries()][0];
        const heading = clean(document.querySelector('h1')?.textContent ?? '');
        if (key === clean(els[0].name) && heading) {
          groups.delete(key);
          groups.set(heading, els);
        }
      }
      const names = [...groups.keys()];
      const exact = names.filter(n => n === want);
      const partial = exact.length > 0 ? exact : names.filter(n => n.includes(want) || want.includes(n));
      if (partial.length !== 1) return { id: null, groups: names };
      const hit = groups.get(partial[0])!.find(el => labelOf(el) === wantOption) ?? groups.get(partial[0])!.find(el => labelOf(el).startsWith(wantOption));
      if (!hit) return { id: null, groups: groups.get(partial[0])!.map(labelOf) };
      if (!hit.id) hit.id = `mcp-radio-${Math.random().toString(36).slice(2)}`;
      return { id: hit.id, groups: [] };
    },
    { question, option },
  );
}

/**
 * Tile-style choices keep the real input 1x1px and visually hidden behind a
 * styled label, so check() cannot hit it; clicking the label does the same.
 */
async function checkViaLabel(page: Page, locator: Locator, checked: boolean): Promise<void> {
  const id = await locator.getAttribute('id');
  const target = id ? page.locator(`label[for="${id.replace(/"/g, '\\"')}"]`).first() : locator.locator('xpath=ancestor::label[1]');
  const isChecked = await locator.isChecked().catch(() => false);
  if (isChecked !== checked) await target.click({ timeout: 2_000 });
}

export async function setFieldByLabel(page: Page, label: string, value: string, kind: FieldKind = 'auto'): Promise<FieldResult> {
  const resolved = await resolveLabel(page, label);
  if (!resolved.ok) {
    // A radio group is addressed by its question, with the option as the value.
    if (kind === 'radio' || kind === 'auto') {
      const radio = await findRadioInGroup(page, label, value);
      if (radio.id) {
        const input = page.locator(`input[type="radio"][id="${radio.id.replace(/"/g, '\\"')}"]`);
        try {
          await input.check({ timeout: 1_000 }).catch(() => checkViaLabel(page, input, true));
          return { ok: true, matchedLabel: label, via: 'radio' };
        } catch (err) {
          return { ok: false, matchedLabel: label, via: 'radio', reason: errorMessage(err) };
        }
      }
      if (kind === 'radio') return { ok: false, reason: 'not_found', candidates: radio.groups };
    }
    return { ok: false, reason: resolved.reason, candidates: resolved.candidates };
  }

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
    if (detected === 'text' || detected === 'select') await locator.waitFor({ state: 'visible', timeout: 1_000 });
    switch (detected) {
      case 'select':
        try {
          await locator.selectOption({ label: value }, { timeout: 1_000 });
        } catch {
          await locator.selectOption({ value }, { timeout: 1_000 });
        }
        break;
      case 'checkbox': {
        const on = /^(true|yes|1|checked|on)$/i.test(value);
        await locator.setChecked(on, { timeout: 1_000 }).catch(() => checkViaLabel(page, locator, on));
        break;
      }
      case 'radio':
        await locator.check({ timeout: 1_000 }).catch(() => checkViaLabel(page, locator, true));
        break;
      default:
        await locator.fill(value, { timeout: 1_000 });
    }
    return { ok: true, matchedLabel, via: detected };
  } catch (err) {
    return { ok: false, matchedLabel, via: detected, reason: errorMessage(err) };
  }
}

/**
 * FreeTaxUSA opens confirmations and side flows in a fancybox iframe
 * (modalcontrol?tp=N) that intercepts clicks on the page beneath.
 */
export function activeModalFrame(page: Page): Frame | null {
  return page.frames().find(f => f.url().includes('/modalcontrol')) ?? null;
}

export interface ModalInfo {
  text: string;
  buttons: string[];
}

export async function readModal(page: Page): Promise<ModalInfo | null> {
  const frame = activeModalFrame(page);
  if (!frame) return null;
  const text = (await frame.locator('body').innerText({ timeout: 2_000 }).catch(() => ''))
    .replace(/^-?\s*closes the window\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 600);
  const buttons = (await frame.locator('button, input[type="submit"], a.btn').allInnerTexts().catch(() => []))
    .map(b => b.trim())
    .filter(b => b && !/closes the window/i.test(b));
  return { text, buttons: [...new Set(buttons)] };
}

export type ButtonResolution =
  | { ok: true; locator: Locator; name: string }
  | { ok: false; reason: 'not_found' | 'ambiguous'; candidates: string[] };

export async function findButton(page: Page, name: string, context?: string): Promise<ButtonResolution> {
  // An open modal covers the page, so its buttons are the only ones clickable.
  const scope: Page | Frame = activeModalFrame(page) ?? page;
  const visible = (l: Locator): Locator => l.filter({ visible: true });
  const exact = visible(scope.getByRole('button', { name, exact: true }).or(scope.getByRole('link', { name, exact: true })));
  let target = exact;
  let count = await exact.count();
  if (count === 0) {
    const pattern = new RegExp(`\\b${escapeRegExp(name)}\\b`, 'i');
    target = visible(scope.getByRole('button', { name: pattern }).or(scope.getByRole('link', { name: pattern })));
    count = await target.count();
  }
  if (count === 0) return { ok: false, reason: 'not_found', candidates: [] };

  const contexts = await target.evaluateAll(elements =>
    elements.map(el => {
      let node: Element | null = el.parentElement;
      for (let i = 0; i < 8 && node; i++) {
        const heading = Array.from(node.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6, legend, .title')).find(
          h => !h.contains(el) && h.getClientRects().length > 0,
        );
        if (heading) return heading.innerText.replace(/open faq window/gi, '').replace(/\s+/g, ' ').trim();
        node = node.parentElement;
      }
      return '';
    }),
  );
  const names = (await target.allInnerTexts()).map(t => t.trim());
  // Context only helps when it differs between the candidates.
  const distinct = new Set(contexts).size > 1;
  const labelled = names.map((n, i) => (distinct && contexts[i] ? `${n || name} (${contexts[i]})` : n || name));

  if (context) {
    const wanted = context.toLowerCase();
    const hits = contexts.map((c, i) => (c.toLowerCase().includes(wanted) ? i : -1)).filter(i => i >= 0);
    if (hits.length === 1) return { ok: true, locator: target.nth(hits[0]), name: labelled[hits[0]] };
    if (hits.length === 0) return { ok: false, reason: 'not_found', candidates: labelled };
    return { ok: false, reason: 'ambiguous', candidates: hits.map(i => labelled[i]) };
  }
  if (count > 1) return { ok: false, reason: 'ambiguous', candidates: labelled };
  return { ok: true, locator: target.first(), name: names[0] || name };
}

/** Click Save and Continue. The caller waits for the page swap and then reads errors. */
export async function clickSaveAndContinue(page: Page): Promise<boolean> {
  const button = page
    .getByRole('button', { name: /save and continue/i })
    .or(page.getByRole('button', { name: /^continue\b/i }))
    .or(page.locator('input[type="submit"][value*="Continue" i]'))
    .first();
  try {
    await button.click({ timeout: 3_000 });
    return true;
  } catch {
    return false;
  }
}

export async function getValidationErrors(page: Page): Promise<string[]> {
  const errors: string[] = [];
  const candidates = page.locator('.audit-message.error-message, .error-message, .error, .err, [role="alert"]');
  const count = Math.min(await candidates.count().catch(() => 0), 20);
  for (let i = 0; i < count; i++) {
    const el = candidates.nth(i);
    if (!(await el.isVisible().catch(() => false))) continue;
    // Drop the screen-reader prefix and the "Fix This" link text FreeTaxUSA adds.
    const text = (await el.innerText().catch(() => ''))
      .replace(/^-?\s*red error message\s*/i, '')
      .replace(/\s*fix this\s*$/i, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (text && !errors.includes(text)) errors.push(text);
  }
  return errors;
}

export async function getPageTitle(page: Page): Promise<string> {
  const h1 = await page.locator('h1').first().innerText({ timeout: 1_000 }).catch(() => '');
  const clean = h1.replace(/open faq window/gi, '').replace(/\s+/g, ' ').trim();
  if (clean) return clean;
  return page.title();
}
