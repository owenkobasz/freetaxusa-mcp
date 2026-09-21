# FreeTaxUSA MCP Server

Browser automation MCP for FreeTaxUSA using Playwright. Fork of schwarztim/freetaxusa-mcp with the audit fixes applied.

## Architecture

- **Transport**: stdio
- **Browser**: the installed Google Chrome, spawned by `src/browser/context.ts` as a detached process on the profile at `~/.freetaxusa-mcp/browser-profile/` with `--remote-debugging-port=0`; Playwright attaches over CDP (`connectOverCDP`) only after a tab reaches the tax app. Playwright's own Chromium launch trips the sign-in bot checks. Chrome outlives the server (a restart reattaches); only `logout` closes it. Headless mode (tests) still uses `launchPersistentContext`.
- **Site model**: the tax app is one URL (`taxcontrol?sid=12`) whose pages load over AJAX into `#page_content`. The current page id is the hidden `fp` input of `#taxForm`; `uniquePageId` changes on every page swap. A bare `GET taxcontrol?sid=N` ends the session, so nothing may ever `page.goto()` or `reload()` while signed in.
- **Navigation**: top-level sidebar groups carry their page id in the wrapper class (`btn-group menu-item-200`); navigation runs the site's `submitTopNavForm(pageId)`. Dropdown sub-pages have random element ids and are reached by clicking. Fallback page ids live in `src/types/sections.ts`.
- **Form interaction**: accessible-label targeting, exact match first, substring only when unique. Labels embed an "Open FAQ window" button; `read_current_page` strips it and `fill_fields` matches on the cleaned prefix. Radio groups are addressed by their question with the option as the value.
- **Modals**: confirmations open in a fancybox iframe (`modalcontrol?tp=N`) that intercepts clicks beneath it. `read_current_page` reports an open modal and `click_button` targets it until it closes.
- **Guards**: `src/security/guards.ts` refuses filing, payment and checkout pages, card fields, and filing or purchase buttons in every tool that acts on a page. The Final Steps landing page "Unlock more benefits" is the add-on cart: priced buttons ("Add for $19.99") add to it, so any priced button and any page with a "Cart Summary" are refused.
- **Redaction**: `src/security/pii-filter.ts` masks SSN, EIN and long digit runs in tool output only. Names, addresses, dates and dollar amounts are not masked, and everything passed as a tool argument is in the Claude Code transcript.
- **Concurrency**: one async mutex serializes all page operations

## Commands

```bash
npm run build    # TypeScript compile
npm test         # Unit tests (the forms suite launches headless Chromium)
npm run dev      # Run with tsx
```

## Tools

`login_manual`, `logout`, `get_session_status`, `list_sections`, `navigate_section`, `expect_page`, `read_current_page`, `fill_fields`, `click_button`, `save_and_continue`, `fill_taxpayer_info`, `fill_filing_status`, `get_tax_summary`, `get_refund_estimate`

## Working rules

- Never ask the user for their FreeTaxUSA password or MFA code. `login_manual` opens the window; they sign in (hCaptcha, sometimes an emailed code, occasionally a Cloudflare checkbox).
- The session idles out after about 10 minutes (`THApp` cookie). A `session_expired` result means sign in again in the same window, then `login_manual`.
- Claude reads and fills. The user reviews, pays for state, and files. Those pages are refused by the guards.
- Call `expect_page` or `read_current_page` before `fill_fields` on a new page.
- `save_and_continue` before `navigate_section`. Navigating away discards unsaved edits.
- Treat `get_refund_estimate` and `get_tax_summary` figures as hints until confirmed on screen.
- Verified on the live site (Sept 2026): sidebar groups Personal=200, Income=301400, Deductions / Credits=460, Misc=301300, Summary=900, State=90080, Final Steps=905; "Tell us about yourself" is page 200; the summary page is a table of `td.summary-current` rows. Expected headings in `src/tools/personal.ts` for filing status are still `TODO(verify on live site)`.
