# Spending & Budget

A macOS desktop app (Tauri + React + Rust) that tracks personal spending against
**weekly, fortnightly, or monthly** budgets, pulling transactions from your everyday
NZ bank account via [Akahu](https://developers.akahu.nz). At the end of each pay
period it shows how much you have **spare to move to savings**.

## Download & install (macOS)

1. Go to the [**Releases**](../../releases) page and download the latest `.dmg`.
2. Open the `.dmg` and drag **Spending & Budget** to your Applications folder.
3. The first time you open it, **right-click the app → Open → Open**. The app isn't
   notarized by Apple, so a normal double-click is blocked by Gatekeeper; this
   right-click step tells macOS you trust it (only needed once).
4. Follow **Connect your bank (Akahu)** below — every user needs their own Akahu
   tokens; the app talks to *your* bank, not a shared server.

> Runs on both Apple Silicon and Intel Macs (universal build). Windows/Linux aren't
> supported yet — the app uses the macOS Keychain to store your tokens.

## Key ideas

- **Pay-period budgeting** — configurable Weekly (default, anchored on payday),
  Fortnightly (every two weeks from a reference payday), or Monthly. Everything
  (budgets, dashboard, surplus) runs on this cycle.
- **Surplus = income − everyday spend − rollover set-asides.** The leftover is your
  "move to savings" number.
- **Category types** — `Income`, `Expense`, `Transfer/Saving` (transfers are excluded
  and hidden). Refunds net against their expense category.
- **Rollover (sinking funds)** — opt a category in and its unspent budget accrues
  across periods, smoothing lumpy bills (rego, insurance).
- **Auto-categorisation** — label a merchant once and it's remembered (merchant→category
  map), auto-filling future uncategorised transactions.
- **Manual entries** — an "Add transaction" button (cash / other card) and **recurring
  bills** (weekly–annual) for payments the everyday account can't see.
- **Full de-duplication** — settled transactions are reconciled by Akahu `_id`; pending
  are wiped and re-fetched each sync so pending→settled never doubles up; a fuzzy guard
  covers the rare same-charge-in-both case.
- **Fully editable** — every transaction field is editable; editing a bank transaction
  locks it against future syncs, with a "Reset to bank data" escape hatch.
- **Local & private** — data in SQLite in the OS app-data dir; Akahu tokens in the
  macOS Keychain, never in the repo.

## Prerequisites

- Node + npm, Rust (`rustup`), Xcode Command Line Tools.

## Develop

```bash
# UI only, in a browser with sample data (mock backend):
npm install
npm run dev            # http://localhost:1420

# Full native app (real SQLite backend):
npm run tauri dev
```

The UI detects whether it's running inside Tauri; in a plain browser it uses a
localStorage mock seeded with a weekly sample so screens can be developed without the
native shell or a bank connection.

## Build a distributable .app

Locally (builds for your Mac's architecture only):

```bash
npm run tauri build
```

Or publish a universal build to GitHub Releases via CI: push a version tag and the
[release workflow](.github/workflows/release.yml) builds the `.dmg` and attaches it to
a **draft** release for you to review and publish.

```bash
git tag v0.1.0
git push origin v0.1.0
```

## Connect your bank (Akahu)

1. Create a **personal app** at [my.akahu.nz/apps](https://my.akahu.nz/apps) and connect
   your everyday account.
2. Copy the **App Token** (`app_token_…`), **App Secret**, and **User Token**
   (`user_token_…`).
3. In the app → **Settings → Akahu connection**, paste them, click **Save credentials**,
   then **Test connection**.
4. Go to **Dashboard → Refresh**. The first pull fetches the current pay period only;
   later pulls fetch since the last sync.

## Project layout

```
src/                  React + TypeScript UI
  lib/                api (Tauri/mock dispatch), types, formatting, toast
  pages/              Dashboard, Transactions, Categories, Budgets, Bills, Settings
src-tauri/src/
  period.rs           weekly/fortnightly/monthly pay-period math (unit-tested)
  db.rs               SQLite schema, queries, surplus/envelope aggregation, reconciliation
  akahu.rs            Akahu HTTP client (settled + pending, cursor pagination)
  sync.rs             pull + de-dup reconciliation + recurring materialisation
  secrets.rs          Keychain token storage
  commands.rs         Tauri command surface
  models.rs           shared serde structs
```
