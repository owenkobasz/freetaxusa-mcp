# I tried to get Claude to do my taxes

I hate doing taxes. Not in a dramatic way. They aren't hard for me, just tedious. Every spring I sit with a W-2 in one window and a tax site in the other, copying numbers from a box labeled "Box 1 - Wages, tips, other compensation" into a field labeled "Box 1 - Wages and Tips." Then fifty more pages of that.

It's the most automatable thing I do all year, and I still do it by hand.

I file with FreeTaxUSA. Federal is free, state is cheap, and the site never makes me feel like I'm being herded toward a premium tier I don't need. I like them a lot, which matters for the rest of this story: I wasn't trying to beat their site, I was trying to use it without the typing.

## The plan

MCP (Model Context Protocol) servers let an AI assistant like Claude call tools: read a file, query a database, click around a browser. Someone had already written one for FreeTaxUSA. It launched a browser with Playwright, and gave Claude tools like "read the current page," "fill these fields" and "save and continue."

That's exactly what I wanted. So I made a throwaway FreeTaxUSA account with fake data, pointed Claude at it, and asked it to log in.

It did not log in.

## It didn't work

The first problem showed up before I'd typed anything interesting. I'd enter my email and password in the browser window, solve the little "click the pictures" puzzle, and get "Something went wrong." The browser console had the real answer: a `403 Forbidden` on the login request. The site had decided I was a bot. Fair enough, since technically I was using one.

Browsers launched by automation tools are easy to spot. Playwright ships its own build of Chromium and runs it with flags that set `navigator.webdriver = true`, which is more or less a sign on its forehead. So I forked the project and started changing things. I spent most of it working through the problem with Claude Code, which I'll admit is a little funny given the goal.

Step one was switching to my real, installed Google Chrome. That got me past the first check and straight into a second one: Cloudflare's full-page "One more step" interstitial, which failed no matter how many times I checked the box. Cloudflare can tell when a debugger is attached to the page, and Playwright attaches one to everything.

The fix was to stop attaching during sign-in. The server now launches Chrome as a plain process, waits while I sign in by hand, and polls Chrome for its list of open tabs over a local HTTP endpoint. That touches nothing on the page. Only once a tab reaches the tax app does it connect and start driving.

That worked. Then it didn't.

## The wrong turn

By this point I'd failed to sign in maybe a dozen times in an hour. New attempts started looping: fill in the form, do the puzzle, land back on the empty form. I made a new account in Firefox with no trouble. Normal Chrome signed in fine. A fresh Chrome profile signed in fine. A fresh Chrome profile with the debugging port turned on failed.

That looked conclusive, so I built an elaborate workaround: sign in with no debugging port, quit Chrome, relaunch it with the port, reattach. That meant making session cookies survive a restart, which Chrome doesn't normally do, which meant another round of fixes. It still kept logging me out.

A few rounds later I signed in without any trouble in a Chrome that did have the port open. The port was never the problem. My best guess is that my IP had simply racked up enough failed attempts that everything looked suspicious for a while. I'd built a two-step restart dance to fix a problem I didn't have.

It did lead me to the real bug, though.

## The real bug

Every time the tool connected after sign-in, it loaded the tax app's address to "make sure it was on the right page." And every time, I was logged out.

FreeTaxUSA's tax app is one page. The address bar says `taxcontrol?sid=12` no matter where you are in your return. Everything after that loads in the background with JavaScript: you click Continue, the site sends the form, and swaps in the next page's content. Load that address directly, without going through the app's buttons, and the server treats it as a bad request and ends your session.

The original project assumed a normal website, where each section has its own URL and you can jump to one by loading it. Here, loading a URL was the logout button.

That changed how everything had to work:

- **Knowing where you are.** The URL is useless. The current page's ID lives in a hidden form field.
- **Getting somewhere else.** You can't go by URL. The tool calls the same JavaScript function the site's own menu calls.
- **Knowing when you've arrived.** There's no page load to wait for. The tool watches another hidden field that changes on every page swap.

Once those were in place, Claude could move around a return, and I stopped getting logged out.

## The full run

With navigation working, I tried a whole return for a made-up person living in Philadelphia:

- a W-2 from a fictional employer: $52,000 in wages, $4,800 federal withholding, state tax withheld
- $125 of bank interest on a 1099-INT
- a $300 donation
- $850 of student loan interest
- a Pennsylvania state return

Every few pages something new broke, and each break was a small lesson in how real websites are built.

**The invisible radio buttons.** Some multiple-choice questions are styled as big clickable tiles. The actual radio button underneath is one pixel square and hidden, so "click the radio button" failed. The fix: click the label instead, like a person would.

**Twenty copies of every state field.** The W-2 form has an "Add Another State" button. To make it instant, the page keeps twenty hidden, pre-built copies of the state section. "Fill Box 17" matched all twenty-one. The tool now only looks at fields you can see.

**Six buttons called "Add."** The income overview has an "Add" button next to every income type. "Click Add" isn't much of an instruction. Buttons now come with the heading of the row they're in, so Claude can ask for "Add, under Investments and Savings."

**The $0 refund.** At the end, the summary tool reported a refund of $0. The page clearly said $775. The tool had been looking for the first row with "refund" in its name, which on this page is "Taxable State Refunds: $0," a line on the income side of the return. It now reads the bottom line.

**The $19.99 I didn't mean to spend.** The last section, Final Steps, opens on a page of paid add-ons with buttons like "Add for $19.99." The tool was supposed to refuse anything to do with payment, but its list of forbidden words was things like "pay," "purchase" and "checkout." "Add for $19.99" contains none of them. So while testing, Claude added Audit Defense to my cart.

Removing it opened a confirmation dialog inside an iframe, which the tool couldn't see, so the "Remove" click silently did nothing. Fixing that meant teaching the tool about dialogs. Now any button with a price on it is refused, along with the add-on product names and the whole cart page.

After all that, the numbers came out right. Adjusted gross income of $51,275, which is $52,000 in wages plus $125 of interest minus $850 of student loan interest. A $775 federal refund, a $22 Pennsylvania refund. The tools read the same figures the screen showed.

## Where it is now

It works, in the sense that a full return can go through it. It's also still janky.

You sign in yourself every time, puzzle and all, and sometimes there's a code in your email. The session times out after ten idle minutes. The last time I tested it, Cloudflare challenged a background request mid-session and the page just sat on "Loading" until I clicked through a check in the window. Large parts of the tax code are untouched: I never tried a business, a rental, dependents or stock sales.

What it doesn't do matters as much as what it does. It never sees your password. It won't touch checkout, payment or e-file. If you ever did file with it, the last clicks would be yours.

## Should you use it?

With a test account, sure. It's a fun thing to watch.

With your real return, I wouldn't, and I haven't. Everything you ask Claude to type goes to the model and into a transcript on your computer. The tool masks Social Security and employer ID numbers in what it reads back, but not your name, address, employer or income. It's built against a website that can change any time, by one person, as a side project. It is not tax software, and it definitely isn't tax advice.

The lesson I didn't expect is that the AI part was the easy part. Claude was happy to read a W-2 and fill in boxes from the start. Everything hard was about the web: bot detection, a site that isn't shaped like a website, hidden fields, invisible buttons, one misleading table row. Getting an agent to understand your taxes is apparently the simple bit. Getting it through the front door is the rest.

The code is on [GitHub](https://github.com/owenkobasz/freetaxusa-mcp). Not affiliated with FreeTaxUSA, who I hope don't mind.
