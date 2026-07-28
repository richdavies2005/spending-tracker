# Changelog

All notable changes to **Spending & Budget**, newest first.

## Unreleased

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
