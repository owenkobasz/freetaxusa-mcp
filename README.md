# FreeTaxUSA MCP Server

An [MCP](https://modelcontextprotocol.io) server that lets an AI agent work through a [FreeTaxUSA](https://www.freetaxusa.com) return with you. It drives a real, visible Chromium window with [Playwright](https://playwright.dev): the agent reads each page, fills fields you tell it to, and reports back. You sign in yourself, you review, and you file.

This is a fork of [schwarztim/freetaxusa-mcp](https://github.com/schwarztim/freetaxusa-mcp) after a security and correctness audit. The main changes: the password never passes through the model, every acting tool refuses filing and payment pages, label matching is exact-first, and the stubbed tools are gone.

Federal filing is free. State is paid at checkout, by you, in the browser.

## How it works

FreeTaxUSA has no API. This server launches Chromium with a persistent profile, and every tool is a browser action: navigate to a section, read the form fields by their accessible labels, fill them, click Save and Continue.

```
You  <->  Claude  <->  freetaxusa-mcp  <->  Chromium (visible)  <->  freetaxusa.com
```

## Tools

| Tool | What it does |
| --- | --- |
| `login_manual` | Opens FreeTaxUSA in the window for you to sign in. Returns `waiting_for_user` if you are still typing; call again when done. Never takes a password. |
| `logout` | Signs out, closes the browser, and deletes the saved profile and cookies. |
| `get_session_status` | Whether a session is active, and which tax year and section is loaded. |
| `list_sections` | The sections found in the sidebar with their SID numbers. |
| `navigate_section` | Jump to a section by name or SID. Save first; navigating discards unsaved edits. |
| `expect_page` | Check that the current heading contains some text. Use before filling. |
| `read_current_page` | All visible form fields with labels, values and options. Password inputs are never read. |
| `fill_fields` | Fill fields on the current page by label. Detects text, select, radio and checkbox. Does not save. |
| `click_button` | Click a button or link by its text. Exact name first, then whole-word match, and only if unique. |
| `save_and_continue` | Submit the page and report validation errors. |
| `fill_taxpayer_info` | Go to the personal info page and fill name, SSN, DOB, address, occupation. |
| `fill_filing_status` | Go to the filing status page and pick a status. |
| `get_tax_summary` | Go to the summary page and read refund or owed, AGI and filing status. |
| `get_refund_estimate` | Read the running federal and state figures from the current page. |

Every tool that acts on a page (`fill_fields`, `click_button`, `save_and_continue`) refuses when the page heading or title looks like filing, payment, checkout or billing. `fill_fields` refuses card, CVV and security-code labels. `click_button` refuses file, submit, pay, purchase, buy, checkout, upgrade and order buttons. There is no override. Those steps are yours.

## Install

Node.js 20 or later.

```bash
git clone https://github.com/owenkobasz/freetaxusa-mcp.git
cd freetaxusa-mcp
npm install       # also downloads Chromium
npm run build
```

Register with Claude Code. The visible window is required, so headless is off:

```bash
claude mcp add --scope user --transport stdio freetaxusa \
  -e FREETAXUSA_HEADLESS=false -e FREETAXUSA_TAX_YEAR=2025 \
  -- node /absolute/path/to/freetaxusa-mcp/dist/index.js
```

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `FREETAXUSA_HEADLESS` | `true` | Must be `false`. Manual login needs a window. |
| `FREETAXUSA_TAX_YEAR` | `2025` | Tax year to open. |
| `FREETAXUSA_USER_DATA_DIR` | `~/.freetaxusa-mcp/browser-profile/` | Chromium profile directory, created with mode 0700. |

## Using it

1. Ask Claude to log in. It calls `login_manual`, a window opens, you sign in including any MFA code. Claude never sees either.
2. Claude calls `list_sections`, navigates, and calls `read_current_page` so you can confirm the labels match the screen.
3. You give Claude the figures from your W-2 or 1099. It calls `fill_fields`, then `save_and_continue`, and reads back any validation errors.
4. At the review, state purchase and e-file steps, Claude stops. You do those in the window.
5. When done, ask Claude to log out. The browser profile and its cookies are deleted.

## What is and is not protected

- **Your password and MFA code** never reach the model, the API or the transcript. You type them in the window.
- **Tool output** passes through a redaction filter that masks SSN-shaped, EIN-shaped and long digit runs. It is a backstop, not a guarantee: it does not mask names, addresses, dates of birth, employer names or dollar amounts.
- **Tool arguments** are not filtered. Whatever you ask Claude to fill is sent to the API and written to the Claude Code transcript under `~/.claude/projects/`. Decide whether that is acceptable before you start, and delete the transcript afterward if you wish. Deleting it removes only the local copy.
- **Session cookies** live in the Chromium profile on disk. Playwright's Chromium uses a mock keychain, so they are readable by any process running as you until `logout` deletes the profile.
- **Automation and the site's terms.** This tool automates a browser against a consumer site. Read FreeTaxUSA's [terms](https://www.freetaxusa.com/terms) and decide for yourself. The practical risk is an account lock, not a data leak.

## Development

```bash
npm run build
npm test            # unit tests; the forms suite launches headless Chromium
npm run dev
```

The page headings that `fill_taxpayer_info`, `fill_filing_status` and `get_tax_summary` expect are marked `TODO(verify on live site)` in the source. Check them against a real session and adjust the regexes.

## Disclaimer

Not affiliated with, endorsed by, or associated with FreeTaxUSA or TaxHawk, Inc. FreeTaxUSA is a registered trademark of TaxHawk, Inc. You are responsible for the accuracy of your return.

## License

MIT
