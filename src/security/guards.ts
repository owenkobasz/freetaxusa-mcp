import { type Page } from 'playwright';

export const FILING_PAGE = /\b(e-?file|file (my|your) return|sign and file|submit (my |your )?return|payment method|payment information|checkout|billing|order summary)\b/i;
export const PAYMENT_FIELD = /\b(card|cvv|cvc|security code)\b/i;
export const DANGEROUS_BUTTON = /\b(e-?file|file|submit|transmit|pay|purchase|buy|checkout|upgrade|order)\b/i;

export interface GuardResult {
  refused: boolean;
  title: string;
}

export function evaluateGuard(title: string, heading: string): GuardResult {
  const label = heading.trim() || title.trim();
  return { refused: FILING_PAGE.test(title) || FILING_PAGE.test(heading), title: label };
}

export async function guardPage(page: Page): Promise<GuardResult> {
  const title = await page.title().catch(() => '');
  const heading = await page.locator('h1').first().innerText({ timeout: 1_000 }).catch(() => '');
  return evaluateGuard(title, heading);
}

export function isPaymentField(label: string): boolean {
  return PAYMENT_FIELD.test(label);
}

export function isDangerousButton(name: string): boolean {
  return DANGEROUS_BUTTON.test(name);
}
