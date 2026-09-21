import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { readFormFields, resolveLabel, setFieldByLabel, findButton, getValidationErrors } from '../../src/browser/forms.js';

const FIXTURE = `
<h1>W-2 Information</h1>
<form>
  <label for="fn">First Name *</label><input id="fn" type="text">
  <label for="email">Email Address</label><input id="email" type="email">
  <label for="addr">Address</label><input id="addr" type="text">
  <label for="st">State</label>
  <select id="st"><option value="">Choose</option><option value="PA">Pennsylvania</option><option value="NJ">New Jersey</option></select>
  <label for="stid">State ID</label><input id="stid" type="text">
  <label for="pw">Password</label><input id="pw" type="password" value="hunter2">
  <fieldset>
    <legend>What is your filing status?</legend>
    <label><input type="radio" name="fs" value="s"> Single</label>
    <label><input type="radio" name="fs" value="m"> Married filing jointly</label>
  </fieldset>
  <label><input type="checkbox" id="cb"> I agree</label>
  <div class="error" style="display:none">Hidden error</div>
  <div class="error">Visible error</div>
  <div class="field-error"></div>
  <button type="button">Edit</button>
  <a href="#">Deductions &amp; Credits</a>
  <button type="button">Add a W-2</button>
  <button type="button">Add a 1099</button>
</form>`;

let browser: Browser;
let page: Page;

beforeAll(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
  await page.setContent(FIXTURE);
}, 60_000);

afterAll(async () => {
  await browser?.close();
});

describe('readFormFields', () => {
  it('omits password inputs', async () => {
    const fields = await readFormFields(page);
    expect(fields.some(f => f.label === 'Password')).toBe(false);
    expect(fields.some(f => f.value === 'hunter2')).toBe(false);
  });

  it('reports a radio group by its legend', async () => {
    const fields = await readFormFields(page);
    const radio = fields.find(f => f.type === 'radio');
    expect(radio?.label).toBe('What is your filing status?');
    expect(radio?.options).toEqual(['Single', 'Married filing jointly']);
  });

  it('includes select options', async () => {
    const fields = await readFormFields(page);
    const state = fields.find(f => f.label === 'State');
    expect(state?.type).toBe('select');
    expect(state?.options).toContain('Pennsylvania');
  });
});

describe('resolveLabel', () => {
  it('matches exactly before substring', async () => {
    const r = await resolveLabel(page, 'State');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.matchedLabel).toBe('State');
  });

  it('matches a label with a trailing required marker', async () => {
    const r = await resolveLabel(page, 'First Name');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.matchedLabel).toBe('First Name *');
  });

  it('does not let "Address" hit "Email Address" when both exist', async () => {
    const r = await resolveLabel(page, 'Address');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.matchedLabel).toBe('Address');
  });

  it('reports ambiguity for a substring with several hits', async () => {
    const r = await resolveLabel(page, 'Stat');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('ambiguous');
      expect(r.candidates).toContain('State ID');
    }
  });

  it('reports not_found', async () => {
    const r = await resolveLabel(page, 'Occupation');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('not_found');
  });
});

describe('setFieldByLabel', () => {
  it('fills text, select, radio and checkbox in auto mode', async () => {
    expect((await setFieldByLabel(page, 'First Name', 'Owen')).via).toBe('text');
    expect((await setFieldByLabel(page, 'State', 'Pennsylvania')).via).toBe('select');
    expect((await setFieldByLabel(page, 'Single', 'true')).via).toBe('radio');
    expect((await setFieldByLabel(page, 'I agree', 'true')).via).toBe('checkbox');

    expect(await page.inputValue('#fn')).toBe('Owen');
    expect(await page.inputValue('#st')).toBe('PA');
    expect(await page.isChecked('input[value="s"]')).toBe(true);
    expect(await page.isChecked('#cb')).toBe(true);
  });

  it('selects a radio option by the group question and option text', async () => {
    const result = await setFieldByLabel(page, 'What is your filing status?', 'Married filing jointly');
    expect(result.ok).toBe(true);
    expect(result.via).toBe('radio');
    expect(await page.isChecked('input[value="m"]')).toBe(true);

    const explicit = await setFieldByLabel(page, 'filing status', 'Single', 'radio');
    expect(explicit.ok).toBe(true);
    expect(await page.isChecked('input[value="s"]')).toBe(true);

    const miss = await setFieldByLabel(page, 'What is your filing status?', 'Head of household', 'radio');
    expect(miss.ok).toBe(false);
    expect(miss.candidates).toEqual(['single', 'married filing jointly']);
  });

  it('selects by value when the option label does not match', async () => {
    const r = await setFieldByLabel(page, 'State', 'NJ', 'select');
    expect(r.ok).toBe(true);
    expect(await page.inputValue('#st')).toBe('NJ');
  });

  it('refuses a kind mismatch', async () => {
    const r = await setFieldByLabel(page, 'State', 'PA', 'text');
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('select');
  });
});

describe('findButton', () => {
  it('prefers the exact name over a substring hit', async () => {
    const r = await findButton(page, 'Edit');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.name).toBe('Edit');
  });

  it('does not match "Edit" inside "Credits" by word boundary', async () => {
    const r = await findButton(page, 'edit');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.name).toBe('Edit');
  });

  it('reports ambiguity with candidates', async () => {
    const r = await findButton(page, 'Add a');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('ambiguous');
      expect(r.candidates).toEqual(['Add a W-2', 'Add a 1099']);
    }
  });

  it('reports not_found', async () => {
    const r = await findButton(page, 'Delete');
    expect(r.ok).toBe(false);
  });
});

describe('getValidationErrors', () => {
  it('returns only visible, non-empty errors', async () => {
    expect(await getValidationErrors(page)).toEqual(['Visible error']);
  });
});
