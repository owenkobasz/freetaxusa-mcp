import { type Page } from 'playwright';

// "Unlock more benefits" is FreeTaxUSA's add-on / cart page under Final Steps.
export const FILING_PAGE =
  /\b(e-?file|file (my|your) return|sign and file|submit (my |your )?return|payment method|payment information|checkout|billing|order summary|cart summary|unlock more benefits|your cart)\b/i;
export const PAYMENT_FIELD = /\b(card|cvv|cvc|security code)\b/i;
// Anything priced ("Add for $19.99") or that adds to a cart counts as a purchase action.
export const DANGEROUS_BUTTON = /\b(e-?file|file|submit|transmit|pay|purchase|buy|checkout|upgrade|order|add to cart|cart)\b|\$\s?\d/i;

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
  // The cart page's h1 is generic; its "Cart Summary" section is the tell.
  const cart = await page.locator('h2, h3').filter({ hasText: /cart summary|order summary/i }).count().catch(() => 0);
  const result = evaluateGuard(title, heading);
  return cart > 0 ? { ...result, refused: true } : result;
}

export function isPaymentField(label: string): boolean {
  return PAYMENT_FIELD.test(label);
}

export function isDangerousButton(name: string): boolean {
  return DANGEROUS_BUTTON.test(name);
}
