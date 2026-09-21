import { z } from 'zod';
import { getPage, isSessionExpired, acquirePageLock } from '../browser/context.js';
import { resolveSid, navigateToSid, assertPage } from '../browser/navigation.js';
import { SECTIONS } from '../types/sections.js';
import { sessionExpiredResult } from './session.js';

// TODO(verify on live site): sidebar and summary-table markup have not been checked against FreeTaxUSA.
const SUMMARY_PAGE = /summary|overview|review/i;

interface LabeledAmounts {
  federalRefund: number | null;
  federalOwed: number | null;
  stateRefund: number | null;
  stateOwed: number | null;
}

function parseAmount(text: string | null | undefined): number | null {
  if (!text) return null;
  const match = text.replace(/,/g, '').match(/-?\$?\s*(\d+(?:\.\d{1,2})?)/);
  return match ? parseFloat(match[1]) : null;
}

async function readLabeledAmounts(): Promise<LabeledAmounts> {
  const page = await getPage();
  const pairs = await page.evaluate(() => {
    const out: Array<{ label: string; text: string }> = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    let node = walker.nextNode();
    while (node) {
      const el = node as HTMLElement;
      const own = Array.from(el.childNodes)
        .filter(n => n.nodeType === Node.TEXT_NODE)
        .map(n => n.textContent?.trim() ?? '')
        .join(' ')
        .trim();
      if (own.length > 0 && own.length < 60 && /\b(federal|state)\b/i.test(own) && /\b(refund|due|owe|owed|balance)\b/i.test(own)) {
        const container = el.closest('tr, li, div, p, dl') ?? el;
        out.push({ label: own, text: (container.textContent ?? '').trim().slice(0, 200) });
      }
      node = walker.nextNode();
    }
    return out;
  });

  const amounts: LabeledAmounts = { federalRefund: null, federalOwed: null, stateRefund: null, stateOwed: null };
  for (const { label, text } of pairs) {
    const isState = /\bstate\b/i.test(label);
    const isOwed = /\b(due|owe|owed|balance)\b/i.test(label);
    const amount = parseAmount(text.replace(label, ''));
    if (amount === null) continue;
    const key: keyof LabeledAmounts = isState ? (isOwed ? 'stateOwed' : 'stateRefund') : isOwed ? 'federalOwed' : 'federalRefund';
    if (amounts[key] === null) amounts[key] = amount;
  }
  return amounts;
}

export const getRefundEstimateSchema = z.object({});

export async function getRefundEstimate(): Promise<Record<string, unknown>> {
  const release = await acquirePageLock();
  try {
    if (await isSessionExpired()) return sessionExpiredResult;
    const amounts = await readLabeledAmounts();
    return { success: true, source: 'sidebar', ...amounts, note: 'Confirm against the browser window before relying on these figures.' };
  } finally {
    release();
  }
}

export const getTaxSummarySchema = z.object({});

export async function getTaxSummary(): Promise<Record<string, unknown>> {
  const release = await acquirePageLock();
  try {
    if (await isSessionExpired()) return sessionExpiredResult;

    const resolved = await resolveSid('summary');
    if (resolved !== null && 'ambiguous' in resolved) {
      return { success: false, error: 'section_ambiguous', candidates: resolved.ambiguous };
    }
    try {
      await navigateToSid(resolved?.sid ?? SECTIONS.summary.fallbackSid!);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message === 'SESSION_EXPIRED') return sessionExpiredResult;
      return { success: false, error: 'navigation_failed', message };
    }

    const page = await getPage();
    const check = await assertPage(page, SUMMARY_PAGE);
    if (!check.ok) return { success: false, error: 'wrong_page', actualTitle: check.actualTitle, expected: SUMMARY_PAGE.source };

    const rows = await page.evaluate(() =>
      Array.from(document.querySelectorAll('tr, dl > div, li'))
        .map(row => {
          const cells = Array.from(row.querySelectorAll('td, th, dt, dd, span, div')).map(c => (c.textContent ?? '').trim()).filter(Boolean);
          return cells.length >= 2 ? { label: cells[0], value: cells[cells.length - 1] } : null;
        })
        .filter((r): r is { label: string; value: string } => r !== null),
    );

    const find = (pattern: RegExp): string | null => rows.find(r => pattern.test(r.label))?.value ?? null;
    const agi = parseAmount(find(/adjusted gross income|\bAGI\b/i));
    const refund = parseAmount(find(/refund/i));
    const owed = parseAmount(find(/amount (due|owed)|balance due|you owe/i));
    const filingStatus = find(/filing status/i);

    return {
      success: true,
      source: 'summary_table',
      refundOrOwed: refund !== null ? 'refund' : owed !== null ? 'owed' : 'unknown',
      amount: refund ?? owed,
      agi,
      filingStatus,
      note: 'Confirm against the browser window before relying on these figures.',
    };
  } finally {
    release();
  }
}
