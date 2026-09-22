import { z } from 'zod';
import { getPage, isSessionExpired, acquirePageLock } from '../browser/context.js';
import { resolveSid, navigateToSid, navigateToItem, assertPage, clearSidMapCache } from '../browser/navigation.js';
import { setFieldByLabel, getValidationErrors, type FieldResult, type FieldKind } from '../browser/forms.js';
import { SECTIONS } from '../types/sections.js';
import { sessionExpiredResult } from './session.js';

// Live site: the taxpayer page is headed "Tell us about yourself".
const TAXPAYER_PAGE = /about yourself|personal|taxpayer|basic info|your info/i;
// TODO(verify on live site): the filing status heading has not been checked against FreeTaxUSA.
const FILING_STATUS_PAGE = /filing status/i;

type NavOutcome = { ok: true } | { ok: false; result: Record<string, unknown> };

async function goToSection(key: keyof typeof SECTIONS, expected: RegExp): Promise<NavOutcome> {
  // Already there (the previous page's save often lands here): don't navigate,
  // which would discard nothing but costs a round trip and a stale section map.
  if ((await assertPage(await getPage(), expected)).ok) return { ok: true };

  clearSidMapCache();
  const resolved = await resolveSid(key);
  if (resolved !== null && 'ambiguous' in resolved) {
    return { ok: false, result: { success: false, error: 'section_ambiguous', candidates: resolved.ambiguous } };
  }
  const sid = resolved !== null && 'sid' in resolved ? resolved.sid : SECTIONS[key].fallbackSid;
  if (!(resolved !== null && 'item' in resolved) && sid === undefined) {
    return { ok: false, result: { success: false, error: 'section_not_found', section: key } };
  }
  try {
    if (resolved !== null && 'item' in resolved) await navigateToItem(resolved.item);
    else await navigateToSid(sid!);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === 'SESSION_EXPIRED') return { ok: false, result: sessionExpiredResult };
    if (message === 'ITEM_INACTIVE') {
      return { ok: false, result: { success: false, error: 'section_inactive', message: 'That page is not available yet; earlier pages must be completed first.' } };
    }
    return { ok: false, result: { success: false, error: 'navigation_failed', message } };
  }
  const check = await assertPage(await getPage(), expected);
  if (!check.ok) {
    return { ok: false, result: { success: false, error: 'wrong_page', actualTitle: check.actualTitle, expected: expected.source } };
  }
  return { ok: true };
}

// The state select's options are full names, not postal codes.
const STATE_NAMES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware',
  DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon',
  PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah',
  VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
  AA: 'Armed Forces - AA', AE: 'Armed Forces - AE', AP: 'Armed Forces - AP',
};

async function firstMatchValue(labels: string[], values: string[], kind: FieldKind = 'auto'): Promise<FieldResult> {
  let last: FieldResult = { ok: false, reason: 'not_found' };
  for (const value of values.filter(Boolean)) {
    last = await firstMatch(labels, value, kind);
    if (last.ok) return last;
  }
  return last;
}

async function firstMatch(labels: string[], value: string, kind: FieldKind = 'auto'): Promise<FieldResult> {
  const page = await getPage();
  let last: FieldResult = { ok: false, reason: 'not_found' };
  for (const label of labels) {
    last = await setFieldByLabel(page, label, value, kind);
    if (last.ok || last.reason === 'ambiguous') return last;
  }
  return last;
}

export const fillTaxpayerInfoSchema = z.object({
  firstName: z.string().min(1).describe('First name'),
  lastName: z.string().min(1).describe('Last name'),
  middleInitial: z.string().max(1).optional().describe('Middle initial'),
  suffix: z.string().optional().describe('Suffix (Jr, Sr, II-VI)'),
  ssn: z.string().regex(/^\d{3}-?\d{2}-?\d{4}$/).describe('Social Security Number (XXX-XX-XXXX)'),
  dob: z.string().regex(/^\d{2}\/\d{2}\/\d{4}$/).describe('Date of birth (MM/DD/YYYY)'),
  occupation: z.string().min(1).describe('Occupation'),
  address: z.object({
    street: z.string().min(1).describe('Street address'),
    apt: z.string().optional().describe('Apartment number'),
    city: z.string().min(1).describe('City'),
    state: z.string().length(2).describe('State code (e.g., PA)'),
    zip: z.string().regex(/^\d{5}$/).describe('ZIP code'),
    zip4: z.string().regex(/^\d{4}$/).optional().describe('ZIP+4'),
  }),
});

export async function fillTaxpayerInfo(input: z.infer<typeof fillTaxpayerInfoSchema>): Promise<Record<string, unknown>> {
  const release = await acquirePageLock();
  try {
    if (await isSessionExpired()) return sessionExpiredResult;

    const nav = await goToSection('taxpayer_info', TAXPAYER_PAGE);
    if (!nav.ok) return nav.result;

    const results: Record<string, FieldResult> = {
      firstName: await firstMatch(['First Name'], input.firstName, 'text'),
      lastName: await firstMatch(['Last Name'], input.lastName, 'text'),
      ssn: await firstMatch(['SSN', 'Social Security Number', 'Social Security'], input.ssn, 'text'),
      dob: await firstMatch(['Date of Birth', 'Birth Date', 'DOB'], input.dob, 'text'),
      occupation: await firstMatch(['Occupation'], input.occupation, 'text'),
      street: await firstMatch(['Street Address', 'Address'], input.address.street, 'text'),
      city: await firstMatch(['City'], input.address.city, 'text'),
      state: await firstMatchValue(['State'], [input.address.state, STATE_NAMES[input.address.state.toUpperCase()] ?? ''], 'select'),
      zip: await firstMatch(['ZIP Code', 'Zip', 'ZIP'], input.address.zip, 'text'),
    };
    if (input.middleInitial) results.middleInitial = await firstMatch(['Middle Initial', 'M.I.'], input.middleInitial, 'text');
    if (input.suffix) results.suffix = await firstMatch(['Suffix', 'Jr., Sr., III'], input.suffix, 'select');
    if (input.address.apt) results.apt = await firstMatch(['Apt', 'Apartment', 'Apt/Unit'], input.address.apt, 'text');
    if (input.address.zip4) results.zip4 = await firstMatch(['ZIP+4', '+4'], input.address.zip4, 'text');

    const errors = await getValidationErrors(await getPage());
    const failed = Object.entries(results).filter(([, r]) => !r.ok).map(([k]) => k);
    return {
      success: failed.length === 0 && errors.length === 0,
      filled: results,
      failed,
      errors: errors.length > 0 ? errors : undefined,
      hint: 'Fields set but not yet saved. Call save_and_continue to submit the page.',
    };
  } finally {
    release();
  }
}

export const fillFilingStatusSchema = z.object({
  status: z.enum(['single', 'married_joint', 'married_separate', 'head_of_household', 'qualifying_widow']).describe('Filing status'),
});

const FILING_STATUS_LABELS: Record<z.infer<typeof fillFilingStatusSchema>['status'], string[]> = {
  single: ['Single'],
  married_joint: ['Married filing jointly', 'Married Filing Jointly'],
  married_separate: ['Married filing separately', 'Married Filing Separately'],
  head_of_household: ['Head of household', 'Head of Household'],
  qualifying_widow: ['Qualifying surviving spouse', 'Qualifying widow(er)', 'Qualifying widow'],
};

export async function fillFilingStatus(input: z.infer<typeof fillFilingStatusSchema>): Promise<Record<string, unknown>> {
  const release = await acquirePageLock();
  try {
    if (await isSessionExpired()) return sessionExpiredResult;

    const nav = await goToSection('filing_status', FILING_STATUS_PAGE);
    if (!nav.ok) return nav.result;

    const labels = FILING_STATUS_LABELS[input.status];
    const result = await firstMatch(labels, 'true', 'radio');
    if (!result.ok) {
      return { success: false, error: 'status_not_found', tried: labels, reason: result.reason, candidates: result.candidates };
    }

    const errors = await getValidationErrors(await getPage());
    return {
      success: errors.length === 0,
      filingStatus: input.status,
      matchedLabel: result.matchedLabel,
      errors: errors.length > 0 ? errors : undefined,
      hint: 'Status selected but not yet saved. Call save_and_continue to submit the page.',
    };
  } finally {
    release();
  }
}
