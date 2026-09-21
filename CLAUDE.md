# FreeTaxUSA MCP Server

Browser automation MCP for FreeTaxUSA using Playwright. Fork of schwarztim/freetaxusa-mcp with the audit fixes applied.

## Architecture

- **Transport**: stdio
- **Browser**: Playwright persistent Chromium context at `~/.freetaxusa-mcp/browser-profile/`, visible window required
- **Navigation**: `?sid=N` URL parameters discovered from the sidebar at runtime, with fallbacks in `src/types/sections.ts`
- **Form interaction**: accessible-label targeting, exact match first, substring only when unique
- **Guards**: `src/security/guards.ts` refuses filing, payment and checkout pages, card fields, and filing or purchase buttons in every tool that acts on a page
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

- Never ask the user for their FreeTaxUSA password or MFA code. `login_manual` opens the window; they sign in.
- Claude reads and fills. The user reviews, pays for state, and files. Those pages are refused by the guards.
- Call `expect_page` or `read_current_page` before `fill_fields` on a new page.
- `save_and_continue` before `navigate_section`. Navigating away discards unsaved edits.
- Treat `get_refund_estimate` and `get_tax_summary` figures as hints until confirmed on screen.
- Expected page headings in `src/tools/personal.ts` and `overview.ts` are marked `TODO(verify on live site)` until checked against a real session.
