# Changelog

All notable changes to **Spare**, newest first.

## v0.8.2

- **A new logo.** The Spare mark — two blocks whose facing edges carve an "S"
  out of the gap between them — now appears in the sidebar and as the app icon,
  replacing the placeholder Tauri icon.
- **Recurring bills has been removed.** The page, its nav entry and the whole
  feature are gone. Transactions those bills already created are untouched and
  stay in your history as normal entries.
- **The app is now called Spare.** Same app, same data — your transactions,
  budgets, categories and Akahu connection all carry over untouched.
- **A quieter, more minimal look.** The summary figures lose their boxes and sit
  straight on the page with Net balance as the single accent block; progress bars
  are now hairlines; badges lose their pills; category dots are smaller; card
  shadows are gone in favour of a single hairline border.
- **Better contrast in dark mode** — the primary button and the "uncategorised"
  banner used white text on a light green/amber fill (about 2.3:1, unreadable).
  Both now use a dark-on-light treatment at over 7:1.
- **Rollover funds no longer carry debt forever.** A fund is now worked out one
  pay period at a time: unspent budget rolls over as before, but an **overspend
  is written off at the next payday** instead of following you around. A fund
  that went badly negative (e.g. −$217 carried over) now starts each payday at
  $0 plus that period's budget.
- **Fixed funds being charged for periods they were never funded in.** If you
  made a category a fund before giving it a budget, everything spent in that gap
  was turned into permanent, unpayable debt. Those periods now correctly accrue
  nothing and cost nothing.
- **Fixed "+-$217.44"** — a negative carry-over was rendered with a stray `+`
  in front of the minus sign. Signs are now correct everywhere in the fund
  breakdown, and $0 no longer shows as "+$0.00".
- **Clearer wording when a fund is overdrawn** — instead of claiming the fund
  "keeps growing", it now tells you how much you're over and that it resets next
  payday.
- **No more ✓/✗ on auto-categorised transactions.** Once you've categorised a
  merchant and the app has learned the rule, matching transactions are filed
  silently — no "Auto" badge and no confirm/reject prompt on every one. You can
  still remove a learned rule under Categories → Merchant map.

## v0.8.1

- **Fixed rollover-fund maths for funds created mid-period.** A fund now always
  covers the whole pay period it was created in, so "Available", "Spent this
  period" and "Left in the fund" always reconcile. Previously a fund made
  part-way through a week ignored earlier spending in that category, so the
  drill-down could show figures that didn't add up (e.g. $10 available, $102.86
  spent, yet "$4 left"). Existing funds are healed automatically on first launch.

## v0.8.0

- **Rollover funds, reworked and much clearer.** A fund now reads like any other
  category — `spent / (budget + carried-over)` with an **Available** line — and
  the confusing "banked in this fund" line is gone. Funds are marked with a small
  ↻ icon and a "· $X rolled over" note.
- **Fund breakdown on drill-down.** Clicking a fund shows a plain-English panel:
  this period's budget, what carried over, available, spent, and what's left —
  plus a one-line explainer.
- **"In your funds" card** replaces "Set aside", showing the total you've saved
  across all your rollover funds.
- **Reset a fund** from its drill-down (with a confirmation) to empty it to $0;
  it starts filling again next payday.
- **Budget changes no longer re-price the past** — a new amount only counts from
  the current period forward, so a fund's balance never jumps unexpectedly.
- One consistent name everywhere: **"rollover fund"**.

## v0.7.0

- **New look — "Ledger":** a warmer, more editorial visual identity. A deep pine-green brand replaces the generic blue, money figures and headings are set in the Fraunces serif, the dashboard's Net Balance panel is a flat colour block (no more gradient), and the sidebar now uses a clean, custom icon set instead of text glyphs.
- **Clickable "uncategorised" banner** — the dashboard prompt now jumps you straight to the Transactions tab.
- **Confirm before deleting** — deleting a manual transaction now asks for a second click ("Confirm delete?").
- **Better screen-reader support** — icon-only buttons (confirm/reject a suggestion, clear search, in-budget toggle) and inline category pickers now have proper labels.

## v0.6.0

A polish release — no new features, just a more refined, accessible app.

- **Visible keyboard focus** — every button, menu item, tab, and input now shows a clear focus ring, so the app is fully navigable by keyboard.
- **Smoother interactions** — buttons, nav items, and the pay-cycle switcher now ease and give a subtle press response instead of snapping; modals and the period dropdown fade/scale in gently.
- **Easier-to-read text** — bumped the contrast on secondary labels and hints (e.g. the "received this period" sub-text) in both light and dark mode.
- **Press Esc to close** any dialog, and dialogs are now announced correctly to screen readers.
- **Respects "Reduce Motion"** — all animations honour the system accessibility setting.

## v0.5.0

- **Pay-cycle switcher** in the dashboard's "Select period" dropdown — switch between Weekly / Fortnightly / Monthly without opening Settings; budgets rescale automatically.
- **Fixed:** the category drill-down now shows transactions for the period/date range you've selected, instead of always the current pay period.

## v0.4.0

- **Custom date-range period selector** — pick a start and end date on the Dashboard (and Transactions) to view any window; the whole dashboard follows it.
- **"Available to spend"** shown under each dashboard category (budget − spent), or "Over by …" when exceeded.
- **Budget traffic-light colours** — spent figure turns green (under), amber (at budget), or red (over).
- **Transaction search** — filter the current view by merchant, description, category, or amount.
- **Budgets auto-scale** when you change the pay cycle (e.g. $100/fortnight → $50/week → $200/month).
- **Alphabetical ordering** — dashboard budgets, the Budgets screen, and the category picker are now A–Z.
- **Grouped category picker** — categories split into Income / Expense / Transfer sections.

## v0.3.0

- **"Net balance"** dashboard headline = total income − total expenses (with "Spare to save" / "Overspent" note), replacing the old "over budget" wording.
- **Category drill-down** — click a dashboard budget to see the transactions that make it up.

## v0.2.0

- **In-app update banner** — the app now tells you when a newer version is available to download.

## v0.1.0

- Initial release: a macOS budgeting app that pulls your NZ bank transactions via Akahu, with weekly/fortnightly/monthly pay-period budgets, rollover (sinking-fund) categories, auto-categorisation, manual + recurring entries, and settled/pending sync.
