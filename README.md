# freetaxusa-mcp

An MCP server that lets Claude fill out a [FreeTaxUSA](https://www.freetaxusa.com) return with you, in a browser window you can watch.

I hate doing taxes. Not because they're hard, but because they're tedious: copying numbers off a W-2 into boxes labeled almost the same way, fifty pages in a row. That felt like exactly the kind of thing an AI agent should be able to take off my plate.

I use FreeTaxUSA because it's cheap, honest and doesn't spend the whole time trying to sell me things. Someone had already built [an MCP server for it](https://github.com/schwarztim/freetaxusa-mcp), so I tried it on a throwaway account. It didn't work against the live site. This is my fork, debugged and reworked until a full sample return went through end to end.

It works now. It's also janky, limited, and very much a personal project. The long version of how it got here is in [docs/writeup.md](docs/writeup.md).

> **Please use a test account.** I have only ever run this with made-up data on a throwaway FreeTaxUSA account, and I'd suggest you do the same. Anything you ask Claude to type goes through the model and into your local transcript, and the output redaction only catches SSNs and EINs. This is an experiment, not a tax tool. You're responsible for anything you file.

## What works

I ran a complete sample return: personal info, a W-2, a 1099-INT, a charitable donation, student loan interest, and a Pennsylvania state return. The refund figures the tools read back ($775 federal, $22 PA) matched the screen.

| | |
| --- | --- |
| Signing in | You do it in a real Chrome window. Claude attaches once you're in. |
| Reattaching | Restarting Claude Code or the server doesn't sign you out. |
| Reading pages | Fields, radio questions, tile-style choices, buttons, dialogs, summaries |
| Filling pages | Text, dropdowns, checkboxes, radios, the W-2 form, repeated rows |
| Moving through the return | Section jumps, Save and Continue, and site validation errors read back |
| Summaries | AGI, taxable income, total tax, refund or amount owed, federal and state |
| Hard stops | The cart, checkout, payment and e-file pages are refused |

## What doesn't (yet)

- **Sign-in always needs you.** hCaptcha every time, sometimes an emailed code, occasionally a Cloudflare checkbox.
- **Sessions idle out after about 10 minutes.** You sign in again in the same window and carry on.
- **Cloudflare can still challenge it mid-session.** When that happens the page hangs on "Loading" until you clear the check in the window.
- **Lightly tested tools.** `fill_filing_status` and `logout` haven't had a full pass since the rework.
- **Only the pages I walked through.** Businesses, rentals, K-1s, crypto sales, dependents and most credits are untested.
- **Filling fields inside pop-up dialogs.** Clicking buttons in them works; typing into them doesn't.

## How it works

FreeTaxUSA has no API, so everything is browser automation.

```
You  <->  Claude  <->  freetaxusa-mcp  <->  Chrome (visible)  <->  freetaxusa.com
```

The server launches your installed Google Chrome with a debugging port and doesn't touch the page while you sign in. Automated browsers get rejected by the site's bot checks, and an attached debugger is enough to trip them. Once a tab reaches the tax app, it connects over the Chrome DevTools Protocol with [Playwright](https://playwright.dev).

The tax app is a single URL that swaps pages in with JavaScript, and loading a page by URL logs you out. So every navigation goes through the site's own buttons and menu functions, and nothing ever reloads the page. [CLAUDE.md](CLAUDE.md) has the details.

## Setup

You need Node.js 20+ and Google Chrome.

```bash
git clone https://github.com/owenkobasz/freetaxusa-mcp.git
cd freetaxusa-mcp
npm install       # also downloads Playwright's Chromium, used only by the tests
npm run build
```

Register it with Claude Code. Headless mode has to be off:

```bash
claude mcp add --scope user --transport stdio freetaxusa \
  -e FREETAXUSA_HEADLESS=false -e FREETAXUSA_TAX_YEAR=2025 \
  -- node /absolute/path/to/freetaxusa-mcp/dist/index.js
```

| Variable | Default | |
| --- | --- | --- |
| `FREETAXUSA_HEADLESS` | `true` | Set to `false`. Sign-in needs a window. |
| `FREETAXUSA_TAX_YEAR` | `2025` | Which year's return to open |
| `FREETAXUSA_USER_DATA_DIR` | `~/.freetaxusa-mcp/browser-profile/` | Chrome profile for this tool, separate from your normal one |
| `FREETAXUSA_CHROME_PATH` | the standard install location | Path to Chrome if it lives somewhere else |

## Using it

1. **Make a test account** on FreeTaxUSA.
2. **Ask Claude to log in.** A Chrome window opens on the sign-in page and you sign in yourself. Claude never sees your password or codes. Ask it to try again once you're in.
3. **Let it read before it writes.** Claude reads each page, tells you what's there, fills what you give it, and saves. If the site rejects something, the error comes back to Claude.
4. **Stop at Final Steps.** Upsells, checkout, state payment and e-file are refused. If you ever file for real, do those yourself in the window.
5. **Log out when done.** That signs you out, closes Chrome and deletes the profile.

The rhythm that worked best for me was: read the page, fill a few fields, save, read again.

## Tools

| Tool | What it does |
| --- | --- |
| `login_manual` | Opens Chrome for you to sign in, then attaches. Call again if it says it's still waiting. |
| `logout` | Signs out, closes Chrome, deletes the profile |
| `get_session_status` | Signed in or not, and which page you're on |
| `list_sections` | Sidebar sections and the pages under each |
| `navigate_section` | Jump to a section or page by name. Save first. |
| `expect_page` | Check the page heading before filling |
| `read_current_page` | Fields, buttons, headings, and any open dialog |
| `fill_fields` | Fill fields by label. For a radio, give the question and the answer. Doesn't save. |
| `click_button` | Click by text. Pass `context` when the same button appears in several rows. |
| `save_and_continue` | Submit the page and report validation errors |
| `fill_taxpayer_info` | Fill name, SSN, birth date, address, occupation |
| `fill_filing_status` | Pick a filing status |
| `get_tax_summary` | Read the federal summary: income, AGI, tax, refund or owed |
| `get_refund_estimate` | Read the running federal and state figures from the header |

## Privacy and safety

- **Your password and sign-in codes** never reach Claude. You type them into Chrome.
- **Anything you ask Claude to fill** goes to the model API and into your Claude Code transcript under `~/.claude/projects/`. That's the main reason to stick to test data.
- **Tool output** is filtered to mask SSNs, EINs and long digit runs. Names, addresses, birth dates, employers and dollar amounts are not masked.
- **The browser profile** keeps your session cookies on disk until `logout` deletes it.
- **Guards** refuse filing, payment, checkout and add-on pages, card fields, and buttons that file, pay, buy, upgrade, or carry a price. There's no override. During testing, before that last rule existed, it added a $19.99 add-on to my cart. I removed it and wrote the rule.

## Development

```bash
npm run build
npm test        # unit tests; the forms suite uses headless Chromium
npm run dev
```

## Credits

Built on [schwarztim/freetaxusa-mcp](https://github.com/schwarztim/freetaxusa-mcp), which had the idea and the tool design. This fork first tightened the security model (manual sign-in, page guards, exact label matching), then rebuilt the browser and navigation layers to work against the live site.

## Disclaimer

This is a personal experiment, provided as-is with no warranty (see the [license](LICENSE)). It isn't tax advice, and you're responsible for the accuracy of any return you prepare or file.

Not affiliated with, endorsed by, or associated with FreeTaxUSA or TaxHawk, Inc. FreeTaxUSA is a registered trademark of TaxHawk, Inc. This tool automates a browser against a consumer website; read FreeTaxUSA's [terms of use](https://www.freetaxusa.com/terms) and decide for yourself whether to use it. Please don't point it at their servers any harder than a person clicking through would.

## License

MIT
