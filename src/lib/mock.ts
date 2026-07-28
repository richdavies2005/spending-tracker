// Browser-only mock backend. Lets the UI run and be verified via `npm run dev`
// where Tauri's `invoke` is unavailable. Persists to localStorage, seeded with a
// weekly (Tuesday) sample. Mirrors the semantics of the Rust backend.
import type {
  Account,
  Budget,
  Category,
  CategoryKind,
  CredentialStatus,
  DashboardRow,
  DashboardSummary,
  MerchantMap,
  RecurringBill,
  Settings,
  SyncResult,
  SyncState,
  Transaction,
} from "./types";

const KEY = "spending-tracker-mock-v4";

interface Store {
  settings: Settings;
  categories: Category[];
  budgets: Budget[];
  accounts: Account[];
  transactions: Transaction[];
  maps: MerchantMap[];
  bills: RecurringBill[];
  sync: SyncState;
  seq: Record<string, number>;
}

// ---- date / period helpers (mirror src-tauri/src/period.rs) ----------------

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}
function parseYmd(s: string): Date {
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}
function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}
function isoWeekday(d: Date): number {
  const day = d.getDay(); // 0=Sun..6=Sat
  return day === 0 ? 7 : day;
}
function daysSinceEpoch(d: Date): number {
  return Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 86400000);
}

// Reference payday that pins the fortnightly cycle (mirrors period.rs).
function fortnightAnchor(s: Settings): Date {
  if (s.income_anchor) {
    const d = parseYmd(s.income_anchor);
    if (!isNaN(d.getTime())) return d;
  }
  // 2000-01-03 is a Monday; shift to the configured weekday.
  const wd = Math.min(Math.max(s.income_day, 1), 7);
  return addDays(new Date(2000, 0, 3), wd - 1);
}
function periodStart(s: Settings, date: Date): Date {
  if (s.income_period === "monthly") {
    const target = Math.min(Math.max(s.income_day, 1), 28);
    const thisStart = new Date(date.getFullYear(), date.getMonth(), target);
    if (date >= thisStart) return thisStart;
    return new Date(date.getFullYear(), date.getMonth() - 1, target);
  }
  if (s.income_period === "fortnightly") {
    const anchor = fortnightAnchor(s);
    const midnight = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const days = Math.round((midnight.getTime() - anchor.getTime()) / 86400000);
    const offset = ((days % 14) + 14) % 14;
    return addDays(date, -offset);
  }
  const anchor = Math.min(Math.max(s.income_day, 1), 7);
  const diff = (isoWeekday(date) - anchor + 7) % 7;
  return addDays(date, -diff);
}
function nextPeriodStart(s: Settings, date: Date): Date {
  const start = periodStart(s, date);
  if (s.income_period === "monthly") {
    return new Date(start.getFullYear(), start.getMonth() + 1, start.getDate());
  }
  return addDays(start, s.income_period === "fortnightly" ? 14 : 7);
}
function periodIndex(s: Settings, date: Date): number {
  const start = periodStart(s, date);
  if (s.income_period === "monthly") return start.getFullYear() * 12 + start.getMonth();
  if (s.income_period === "fortnightly") {
    const anchor = fortnightAnchor(s);
    return Math.round((start.getTime() - anchor.getTime()) / (14 * 86400000));
  }
  return Math.floor(daysSinceEpoch(start) / 7);
}

// ---- seed ------------------------------------------------------------------

function seed(): Store {
  const settings: Settings = { income_period: "weekly", income_day: 2, income_anchor: null }; // Tuesday
  const start = periodStart(settings, new Date());
  const at = (offset: number) => `${ymd(addDays(start, offset))}T12:00:00Z`;

  const categories: Category[] = [
    cat(1, "Salary", "#3a9d78", 1, "income", false),
    cat(2, "Groceries", "#4caf82", 2, "expense", false),
    cat(3, "Fuel", "#e0a458", 3, "expense", false),
    cat(4, "Social", "#c471ed", 4, "expense", false),
    cat(5, "Snacks", "#e86a6a", 5, "expense", false),
    { ...cat(6, "Vehicle expenses", "#5b8def", 6, "expense", true), rollover_start: ymd(addDays(start, -21)) },
    cat(7, "To Savings", "#8b95a7", 7, "transfer", false),
  ];

  const budgets: Budget[] = [
    b(1, 2, 150, ymd(start)),
    b(2, 3, 70, ymd(start)),
    b(3, 4, 100, ymd(start)),
    b(4, 5, 40, ymd(start)),
    b(5, 6, 25, ymd(addDays(start, -21))),
  ];

  const tx: Transaction[] = [
    t("s1", at(0), 1000, "Weekly pay", "Employer", 1, "akahu", "settled"),
    t("s2", at(0), -84.2, "PAK'nSAVE", "PAK'nSAVE", 2, "akahu", "settled"),
    t("s3", at(1), -55, "BP Connect", "BP", 3, "akahu", "settled"),
    t("s4", at(2), -40, "The Establishment", "The Establishment", 4, "akahu", "settled"),
    t("s5", at(2), -12, "Corner Dairy", "Corner Dairy", 5, "akahu", "settled"),
    t("s6", at(1), -200, "Transfer to savings", null, 7, "akahu", "settled"),
    t("s7", at(3), -23.5, "SQ *UNKNOWN CAFE", "Unknown Cafe", null, "akahu", "settled"),
    // Description-only (no merchant) — will be auto-suggested by the desckey map below.
    t("s8", at(3), -37.9, "Pak N Save S Card number: 4835 **** 9516", null, null, "akahu", "settled"),
    t("p1", at(3), -6.5, "Mojo Coffee", "Mojo", null, "akahu", "pending"),
  ];

  const store: Store = {
    settings,
    categories,
    budgets,
    accounts: [{ id: "acc-1", name: "Everyday", connection: "ANZ", enabled: true }],
    transactions: tx,
    // A previously-learned rule: description key "pak n save s" -> Groceries.
    maps: [{ id: 1, field: "desckey", pattern: "pak n save s", category_id: 2 }],
    bills: [
      {
        id: 1,
        name: "Car & Motorcycle Insurance",
        amount: 110,
        category_id: 6,
        frequency: "monthly",
        anchor_date: ymd(start),
        active: true,
      },
    ],
    sync: { last_sync_at: null, last_run_status: null },
    seq: { category: 7, budget: 5, map: 1, bill: 1, tx: 0 },
  };
  applyMaps(store); // mark the matching description-only row as a suggestion
  return store;
}

function cat(
  id: number,
  name: string,
  color: string,
  sort: number,
  kind: CategoryKind,
  rollover: boolean,
): Category {
  return { id, name, color, sort_order: sort, kind, rollover, rollover_start: null };
}
function b(id: number, category_id: number, amount: number, from: string): Budget {
  return { id, category_id, amount, effective_from: from };
}
function t(
  id: string,
  date: string,
  amount: number,
  description: string,
  merchant: string | null,
  cat: number | null,
  source: "akahu" | "manual" | "recurring",
  status: "settled" | "pending",
): Transaction {
  return {
    id,
    account_id: "acc-1",
    date,
    amount,
    description,
    merchant_name: merchant,
    akahu_category: null,
    user_category_id: cat,
    source,
    status,
    edited: false,
    suggested: false,
    in_budget: true,
  };
}

/** Mirror of db.rs desc_key: normalise a description into a match key. */
function descKey(description: string | null): string | null {
  if (!description) return null;
  let s = description.toLowerCase();
  for (const marker of ["card number", "card no", "card ending"]) {
    const idx = s.indexOf(marker);
    if (idx >= 0) s = s.slice(0, idx);
  }
  const key = s
    .split(/\s+/)
    .map((t) => t.replace(/[^a-z0-9]/g, ""))
    .filter((t) => t.length > 0 && !/[0-9]/.test(t))
    .join(" ");
  return key.length ? key : null;
}

// ---- store io --------------------------------------------------------------

function load(): Store {
  const raw = localStorage.getItem(KEY);
  if (raw) {
    try {
      return JSON.parse(raw) as Store;
    } catch {
      /* reseed */
    }
  }
  const s = seed();
  save(s);
  return s;
}
function save(s: Store) {
  localStorage.setItem(KEY, JSON.stringify(s));
}

function applyMaps(s: Store): number {
  let n = 0;
  for (const m of s.maps) {
    for (const t of s.transactions) {
      if (t.user_category_id != null) continue;
      let hit = false;
      if (m.field === "merchant") {
        hit = t.merchant_name?.toLowerCase() === m.pattern.toLowerCase();
      } else if (m.field === "desckey") {
        hit = descKey(t.description) === m.pattern;
      } else {
        hit = !!t.description?.toLowerCase().includes(m.pattern.toLowerCase());
      }
      if (hit) {
        t.user_category_id = m.category_id;
        t.suggested = true; // auto-applied → awaits confirm
        n++;
      }
    }
  }
  return n;
}

function inPeriod(s: Store, t: Transaction): boolean {
  const start = periodStart(s.settings, new Date());
  const end = nextPeriodStart(s.settings, new Date());
  const d = parseYmd(t.date);
  return d >= start && d < end;
}
function currentBudget(s: Store, categoryId: number): number {
  const today = ymd(new Date());
  return (
    s.budgets
      .filter((x) => x.category_id === categoryId && x.effective_from <= today)
      .sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1))[0]?.amount ?? 0
  );
}

// ---- command dispatch ------------------------------------------------------

export async function mockInvoke(cmd: string, a: any = {}): Promise<any> {
  const s = load();
  const done = (v: any = null) => {
    save(s);
    return v;
  };

  switch (cmd) {
    case "get_settings":
      return s.settings;
    case "set_settings":
      s.settings = {
        income_period: a.incomePeriod,
        income_day: a.incomeDay,
        income_anchor: a.incomeAnchor ?? null,
      };
      return done();

    case "categories_list":
      return [...s.categories].sort((x, y) => x.sort_order - y.sort_order);
    case "category_create": {
      const c: Category = {
        id: ++s.seq.category,
        name: a.name,
        color: a.color,
        sort_order: s.categories.length + 1,
        kind: a.kind,
        rollover: a.rollover,
        rollover_start: a.rollover ? ymd(new Date()) : null,
      };
      s.categories.push(c);
      return done(c);
    }
    case "category_update": {
      const c = s.categories.find((x) => x.id === a.id);
      if (c) {
        if (a.rollover && !c.rollover) c.rollover_start = ymd(new Date());
        if (!a.rollover) c.rollover_start = null;
        Object.assign(c, {
          name: a.name,
          color: a.color,
          sort_order: a.sortOrder,
          kind: a.kind,
          rollover: a.rollover,
        });
      }
      return done();
    }
    case "category_delete":
      s.categories = s.categories.filter((c) => c.id !== a.id);
      s.budgets = s.budgets.filter((x) => x.category_id !== a.id);
      s.transactions.forEach((t) => {
        if (t.user_category_id === a.id) t.user_category_id = null;
      });
      return done();

    case "budgets_list":
      return s.budgets;
    case "budget_set": {
      const ex = s.budgets.find(
        (x) => x.category_id === a.categoryId && x.effective_from === a.effectiveFrom,
      );
      if (ex) ex.amount = a.amount;
      else
        s.budgets.push({
          id: ++s.seq.budget,
          category_id: a.categoryId,
          amount: a.amount,
          effective_from: a.effectiveFrom,
        });
      return done();
    }
    case "budget_delete":
      s.budgets = s.budgets.filter((x) => x.id !== a.id);
      return done();

    case "accounts_list":
      return s.accounts;
    case "account_set_enabled": {
      const acc = s.accounts.find((x) => x.id === a.id);
      if (acc) acc.enabled = a.enabled;
      return done();
    }

    case "map_list":
      return s.maps;
    case "map_delete":
      s.maps = s.maps.filter((m) => m.id !== a.id);
      return done();

    case "bills_list":
      return s.bills;
    case "bill_create": {
      const bill: RecurringBill = {
        id: ++s.seq.bill,
        name: a.name,
        amount: a.amount,
        category_id: a.categoryId ?? null,
        frequency: a.frequency,
        anchor_date: a.anchorDate,
        active: true,
      };
      s.bills.push(bill);
      return done(bill.id);
    }
    case "bill_update": {
      const bill = s.bills.find((x) => x.id === a.id);
      if (bill)
        Object.assign(bill, {
          name: a.name,
          amount: a.amount,
          category_id: a.categoryId ?? null,
          frequency: a.frequency,
          anchor_date: a.anchorDate,
          active: a.active,
        });
      return done();
    }
    case "bill_delete":
      s.bills = s.bills.filter((x) => x.id !== a.id);
      return done();

    case "transactions_list": {
      const transferIds = new Set(
        s.categories.filter((c) => c.kind === "transfer").map((c) => c.id),
      );
      return s.transactions
        .filter((t) => a.allPeriods || inPeriod(s, t))
        .filter(
          (t) =>
            a.showTransfers ||
            t.user_category_id == null ||
            !transferIds.has(t.user_category_id),
        )
        .sort((x, y) => (x.date < y.date ? 1 : -1));
    }
    case "transaction_set_category": {
      const t = s.transactions.find((x) => x.id === a.id);
      if (t) {
        t.user_category_id = a.categoryId ?? null;
        t.suggested = false;
      }
      let n = 0;
      if (a.learn && a.categoryId != null && t) {
        // Learn on merchant if present, else on the normalised description key.
        const field = t.merchant_name ? "merchant" : "desckey";
        const pattern = t.merchant_name ?? descKey(t.description);
        if (pattern) {
          const ex = s.maps.find((m) => m.field === field && m.pattern === pattern);
          if (ex) ex.category_id = a.categoryId;
          else
            s.maps.push({
              id: ++s.seq.map,
              field: field as "merchant" | "desckey",
              pattern,
              category_id: a.categoryId,
            });
          n = applyMaps(s);
        }
      }
      return done(n);
    }
    case "transaction_confirm": {
      const t = s.transactions.find((x) => x.id === a.id);
      if (t) t.suggested = false;
      return done();
    }
    case "transaction_reject": {
      const t = s.transactions.find((x) => x.id === a.id);
      if (t) {
        // Remove the map that produced the wrong suggestion, then uncategorise.
        const key = t.merchant_name
          ? { field: "merchant", pattern: t.merchant_name }
          : { field: "desckey", pattern: descKey(t.description) };
        s.maps = s.maps.filter(
          (m) => !(m.field === key.field && m.pattern === key.pattern),
        );
        t.user_category_id = null;
        t.suggested = false;
      }
      return done();
    }
    case "transaction_set_in_budget": {
      const t = s.transactions.find((x) => x.id === a.id);
      if (t) t.in_budget = a.inBudget;
      return done();
    }
    case "transaction_edit": {
      const t = s.transactions.find((x) => x.id === a.id);
      if (t)
        Object.assign(t, {
          date: a.date,
          amount: a.amount,
          description: a.description,
          merchant_name: a.merchantName,
          user_category_id: a.categoryId ?? null,
          edited: true,
        });
      return done();
    }
    case "transaction_reset": {
      const t = s.transactions.find((x) => x.id === a.id);
      if (t) t.edited = false;
      return done();
    }
    case "transaction_delete":
      s.transactions = s.transactions.filter(
        (t) => !(t.id === a.id && (t.source === "manual" || t.source === "recurring")),
      );
      return done();
    case "transactions_trim_count":
    case "transactions_trim": {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - Number(a.keepDays));
      const iso = cutoff.toISOString().slice(0, 10);
      const older = s.transactions.filter((t) => t.date.slice(0, 10) < iso);
      if (cmd === "transactions_trim_count") return older.length;
      s.transactions = s.transactions.filter((t) => t.date.slice(0, 10) >= iso);
      return done(older.length);
    }
    case "manual_add": {
      const tx: Transaction = {
        id: `manual-${Date.now()}-${++s.seq.tx}`,
        account_id: null,
        date: a.date,
        amount: a.amount,
        description: a.description ?? null,
        merchant_name: a.merchantName ?? null,
        akahu_category: null,
        user_category_id: a.categoryId ?? null,
        source: "manual",
        status: "settled",
        edited: false,
        suggested: false,
        in_budget: true,
      };
      s.transactions.push(tx);
      return done(tx);
    }

    case "dashboard":
      return done(dashboard(s));

    case "sync_state_get":
      return s.sync;
    case "sync_full":
    case "sync_from_bank":
    case "sync_now": {
      const now = new Date().toISOString();
      s.sync = { last_sync_at: now, last_run_status: "0 new, 0 updated (mock)" };
      const res: SyncResult = {
        inserted: 0,
        updated: 0,
        deleted: 0,
        pending: s.transactions.filter((t) => t.status === "pending").length,
        total_transactions: s.transactions.length,
        last_sync_at: now,
      };
      return done(res);
    }
    case "akahu_diagnostic": {
      const recent = [...s.transactions]
        .sort((x, y) => y.date.localeCompare(x.date))
        .slice(0, 15)
        .map((t) => ({
          date: t.date,
          amount: t.amount,
          description: t.description,
          merchant: t.merchant_name,
          status: t.status,
        }));
      const settled = s.transactions.filter((t) => t.status === "settled");
      const pending = s.transactions.filter((t) => t.status === "pending");
      const newest = (rows: typeof s.transactions) => {
        const dates = rows.map((r) => r.date).sort();
        return dates.length ? dates[dates.length - 1] : null;
      };
      return done({
        account_count: s.accounts.length,
        refreshed_at: new Date().toISOString(),
        settled_count: settled.length,
        newest_settled_date: newest(settled),
        pending_count: pending.length,
        newest_pending_date: newest(pending),
        recent,
      });
    }

    case "credentials_status":
      return mockCreds();
    case "save_credentials": {
      const c = mockCreds();
      if (a.appToken?.trim()) c.app_token = true;
      if (a.appSecret?.trim()) c.app_secret = true;
      if (a.userToken?.trim()) c.user_token = true;
      localStorage.setItem("spending-tracker-mock-creds", JSON.stringify(c));
      return c;
    }
    case "clear_credentials": {
      const c = { app_token: false, app_secret: false, user_token: false };
      localStorage.setItem("spending-tracker-mock-creds", JSON.stringify(c));
      return c;
    }
    case "akahu_validate":
      return "Demo User (mock)";
    case "check_for_update":
      return { current: "0.0.0", latest: "0.0.0", available: false, url: "" };

    default:
      throw new Error(`mock: unknown command "${cmd}"`);
  }
}

function dashboard(s: Store): DashboardSummary {
  const start = periodStart(s.settings, new Date());
  const end = nextPeriodStart(s.settings, new Date());
  const within = (t: Transaction) => {
    const d = parseYmd(t.date);
    return t.in_budget && d >= start && d < end;
  };

  let income = 0;
  let expenseSpent = 0;
  let rolloverBudget = 0;
  const rows: DashboardRow[] = [];

  for (const c of s.categories) {
    const net = s.transactions
      .filter((t) => t.user_category_id === c.id && within(t))
      .reduce((sum, t) => sum + t.amount, 0);
    const budget = currentBudget(s, c.id);
    let spent = 0;
    let envelope = 0;

    if (c.kind === "income") {
      income += net;
    } else if (c.kind === "transfer") {
      /* excluded */
    } else {
      spent = -net;
      expenseSpent += spent; // all expense categories count toward total spend
      if (c.rollover) {
        rolloverBudget += budget; // informational (Set aside), not subtracted from net
        const since = c.rollover_start ?? ymd(start);
        const elapsed = periodIndex(s.settings, new Date()) - periodIndex(s.settings, parseYmd(since)) + 1;
        const totalSpend = s.transactions
          .filter(
            (t) =>
              t.in_budget &&
              t.user_category_id === c.id &&
              parseYmd(t.date) >= parseYmd(since),
          )
          .reduce((sum, t) => sum - t.amount, 0);
        envelope = Math.max(elapsed, 0) * budget - totalSpend;
      }
    }

    rows.push({
      category_id: c.id,
      category_name: c.name,
      color: c.color,
      kind: c.kind,
      rollover: c.rollover,
      budget,
      spent,
      envelope_balance: envelope,
    });
  }

  const uncategorized_count = s.transactions.filter(
    (t) => t.user_category_id == null && within(t),
  ).length;

  return {
    period_start: ymd(start),
    period_end: ymd(end),
    income,
    expense_spent: expenseSpent,
    rollover_budget: rolloverBudget,
    surplus: income - expenseSpent,
    rows,
    uncategorized_count,
  };
}

function mockCreds(): CredentialStatus {
  const raw = localStorage.getItem("spending-tracker-mock-creds");
  if (raw) return JSON.parse(raw) as CredentialStatus;
  return { app_token: false, app_secret: false, user_token: false };
}
