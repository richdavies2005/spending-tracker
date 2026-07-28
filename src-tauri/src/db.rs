use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use chrono::{Duration, NaiveDate};
use rusqlite::{params, Connection, OptionalExtension, Row};

use crate::error::{AppError, AppResult};
use crate::models::*;
use crate::period;

/// Tauri-managed database handle: a single connection guarded by a mutex, which
/// is ample for a local single-user desktop app.
pub struct Db(pub Mutex<Connection>);

static ID_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Generate a unique synthetic id for manual transactions.
fn gen_id(prefix: &str) -> String {
    let n = ID_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{}-{}-{}", prefix, chrono::Utc::now().timestamp_millis(), n)
}

impl Db {
    pub fn open(path: &std::path::Path) -> AppResult<Self> {
        let conn = Connection::open(path)?;
        conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;")?;
        init_schema(&conn)?;
        Ok(Db(Mutex::new(conn)))
    }
}

fn init_schema(conn: &Connection) -> AppResult<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS settings (
            id            INTEGER PRIMARY KEY CHECK (id = 1),
            income_period TEXT NOT NULL DEFAULT 'weekly',
            income_day    INTEGER NOT NULL DEFAULT 2
        );
        INSERT OR IGNORE INTO settings (id, income_period, income_day) VALUES (1, 'weekly', 2);

        CREATE TABLE IF NOT EXISTS categories (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            name           TEXT NOT NULL,
            color          TEXT NOT NULL DEFAULT '#8899aa',
            sort_order     INTEGER NOT NULL DEFAULT 0,
            kind           TEXT NOT NULL DEFAULT 'expense',   -- income|expense|transfer
            rollover       INTEGER NOT NULL DEFAULT 0,
            rollover_start TEXT
        );

        CREATE TABLE IF NOT EXISTS budgets (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            category_id    INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
            amount         REAL NOT NULL,
            effective_from TEXT NOT NULL,
            UNIQUE(category_id, effective_from)
        );

        CREATE TABLE IF NOT EXISTS accounts (
            id         TEXT PRIMARY KEY,
            name       TEXT NOT NULL,
            connection TEXT,
            enabled    INTEGER NOT NULL DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS transactions (
            id                TEXT PRIMARY KEY,
            account_id        TEXT,
            date              TEXT NOT NULL,
            amount            REAL NOT NULL,
            description       TEXT,
            merchant_name     TEXT,
            akahu_category    TEXT,
            user_category_id  INTEGER REFERENCES categories(id) ON DELETE SET NULL,
            source            TEXT NOT NULL DEFAULT 'akahu',    -- akahu|manual|recurring
            status            TEXT NOT NULL DEFAULT 'settled',  -- settled|pending
            edited            INTEGER NOT NULL DEFAULT 0,
            suggested         INTEGER NOT NULL DEFAULT 0,
            in_budget         INTEGER NOT NULL DEFAULT 1,
            updated_at        TEXT,
            raw_json          TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(date);
        CREATE INDEX IF NOT EXISTS idx_tx_cat  ON transactions(user_category_id);
        CREATE INDEX IF NOT EXISTS idx_tx_ss   ON transactions(source, status);

        CREATE TABLE IF NOT EXISTS merchant_map (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            field       TEXT NOT NULL,   -- merchant|description
            pattern     TEXT NOT NULL,
            category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
            UNIQUE(field, pattern)
        );

        CREATE TABLE IF NOT EXISTS recurring_bills (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT NOT NULL,
            amount      REAL NOT NULL,
            category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
            frequency   TEXT NOT NULL,   -- weekly|fortnightly|monthly|annual
            anchor_date TEXT NOT NULL,
            active      INTEGER NOT NULL DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS sync_state (
            id              INTEGER PRIMARY KEY CHECK (id = 1),
            last_sync_at    TEXT,
            last_run_status TEXT
        );
        INSERT OR IGNORE INTO sync_state (id, last_sync_at, last_run_status) VALUES (1, NULL, NULL);
        ",
    )?;
    // Migrations for databases created before a column existed.
    ensure_column(conn, "transactions", "suggested", "INTEGER NOT NULL DEFAULT 0")?;
    ensure_column(conn, "transactions", "in_budget", "INTEGER NOT NULL DEFAULT 1")?;
    // Anchor date for the fortnightly cycle (which two-week block is a pay period).
    ensure_column(conn, "settings", "income_anchor", "TEXT")?;
    Ok(())
}

/// Add a column if the table doesn't already have it (simple forward migration).
fn ensure_column(conn: &Connection, table: &str, column: &str, decl: &str) -> AppResult<()> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let has = stmt
        .query_map([], |r| r.get::<_, String>(1))?
        .filter_map(Result::ok)
        .any(|name| name == column);
    if !has {
        conn.execute(&format!("ALTER TABLE {table} ADD COLUMN {column} {decl}"), [])?;
    }
    Ok(())
}

/// Normalise a transaction description into a stable match key: lowercase, drop
/// card numbers and any token containing digits (card/account/reference numbers),
/// keep the meaningful words including short suffixes like "s"/"f". So
/// "Pak N Save S" -> "pak n save s" but "Pak N Save F" -> "pak n save f", and
/// "Mcdonalds Mt Card number: 4835 **** 9516" -> "mcdonalds mt".
pub fn desc_key(description: Option<&str>) -> Option<String> {
    let mut s = description?.to_lowercase();
    for marker in ["card number", "card no", "card ending"] {
        if let Some(idx) = s.find(marker) {
            s.truncate(idx);
        }
    }
    let key = s
        .split_whitespace()
        .map(|t| t.chars().filter(|c| c.is_alphanumeric()).collect::<String>())
        .filter(|t| !t.is_empty() && !t.chars().any(|c| c.is_ascii_digit()))
        .collect::<Vec<_>>()
        .join(" ");
    if key.is_empty() {
        None
    } else {
        Some(key)
    }
}

// ----------------------------------------------------------------------------
// Settings
// ----------------------------------------------------------------------------

pub fn get_settings(conn: &Connection) -> AppResult<Settings> {
    let s = conn
        .query_row(
            "SELECT income_period, income_day, income_anchor FROM settings WHERE id = 1",
            [],
            |r| {
                Ok(Settings {
                    income_period: r.get(0)?,
                    income_day: r.get(1)?,
                    income_anchor: r.get(2)?,
                })
            },
        )
        .optional()?;
    Ok(s.unwrap_or_default())
}

/// Length of a pay period in "weeks", used to rescale budgets when the cycle
/// changes. The user's model: weekly : fortnightly : monthly = 1 : 2 : 4, so a
/// $100 fortnightly budget becomes $50 weekly or $200 monthly.
fn period_weeks(period: &str) -> f64 {
    match period {
        "monthly" => 4.0,
        "fortnightly" => 2.0,
        _ => 1.0,
    }
}

pub fn set_settings(conn: &Connection, s: &Settings) -> AppResult<()> {
    // If the cycle length changes, rescale every stored budget so the underlying
    // spending rate is preserved (a per-fortnight $100 becomes per-week $50, etc.).
    let old = get_settings(conn)?;
    let factor = period_weeks(&s.income_period) / period_weeks(&old.income_period);

    conn.execute(
        "UPDATE settings SET income_period = ?1, income_day = ?2, income_anchor = ?3 WHERE id = 1",
        params![s.income_period, s.income_day, s.income_anchor],
    )?;
    if (factor - 1.0).abs() > f64::EPSILON {
        conn.execute("UPDATE budgets SET amount = ROUND(amount * ?1, 2)", params![factor])?;
    }
    Ok(())
}

// ----------------------------------------------------------------------------
// Categories
// ----------------------------------------------------------------------------

fn row_to_category(r: &Row) -> rusqlite::Result<Category> {
    Ok(Category {
        id: r.get(0)?,
        name: r.get(1)?,
        color: r.get(2)?,
        sort_order: r.get(3)?,
        kind: r.get(4)?,
        rollover: r.get::<_, i64>(5)? != 0,
        rollover_start: r.get(6)?,
    })
}

pub fn categories_list(conn: &Connection) -> AppResult<Vec<Category>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, color, sort_order, kind, rollover, rollover_start
         FROM categories ORDER BY sort_order, name",
    )?;
    let rows = stmt.query_map([], row_to_category)?.collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn category_create(
    conn: &Connection,
    name: &str,
    color: &str,
    kind: &str,
    rollover: bool,
) -> AppResult<Category> {
    let sort: i64 =
        conn.query_row("SELECT COALESCE(MAX(sort_order),0)+1 FROM categories", [], |r| r.get(0))?;
    let rollover_start = if rollover { Some(today_str()) } else { None };
    conn.execute(
        "INSERT INTO categories (name, color, sort_order, kind, rollover, rollover_start)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![name, color, sort, kind, rollover as i64, rollover_start],
    )?;
    let id = conn.last_insert_rowid();
    Ok(Category {
        id,
        name: name.into(),
        color: color.into(),
        sort_order: sort,
        kind: kind.into(),
        rollover,
        rollover_start,
    })
}

pub fn category_update(
    conn: &Connection,
    id: i64,
    name: &str,
    color: &str,
    sort_order: i64,
    kind: &str,
    rollover: bool,
) -> AppResult<()> {
    // When rollover is first switched on, stamp its start date so the envelope
    // begins accruing from now (not retroactively).
    let existing: Option<(i64, Option<String>)> = conn
        .query_row(
            "SELECT rollover, rollover_start FROM categories WHERE id = ?1",
            params![id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    let rollover_start = match existing {
        Some((0, _)) if rollover => Some(today_str()),
        Some((_, prev)) if rollover => prev.or_else(|| Some(today_str())),
        _ => None,
    };
    conn.execute(
        "UPDATE categories SET name=?2, color=?3, sort_order=?4, kind=?5, rollover=?6,
             rollover_start=?7 WHERE id=?1",
        params![id, name, color, sort_order, kind, rollover as i64, rollover_start],
    )?;
    Ok(())
}

pub fn category_delete(conn: &Connection, id: i64) -> AppResult<()> {
    conn.execute("DELETE FROM categories WHERE id = ?1", params![id])?;
    Ok(())
}

// ----------------------------------------------------------------------------
// Budgets
// ----------------------------------------------------------------------------

pub fn budgets_list(conn: &Connection) -> AppResult<Vec<Budget>> {
    let mut stmt = conn.prepare(
        "SELECT id, category_id, amount, effective_from FROM budgets
         ORDER BY category_id, effective_from",
    )?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Budget {
                id: r.get(0)?,
                category_id: r.get(1)?,
                amount: r.get(2)?,
                effective_from: r.get(3)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn budget_set(
    conn: &Connection,
    category_id: i64,
    amount: f64,
    effective_from: &str,
) -> AppResult<()> {
    conn.execute(
        "INSERT INTO budgets (category_id, amount, effective_from) VALUES (?1, ?2, ?3)
         ON CONFLICT(category_id, effective_from) DO UPDATE SET amount = excluded.amount",
        params![category_id, amount, effective_from],
    )?;
    Ok(())
}

pub fn budget_delete(conn: &Connection, id: i64) -> AppResult<()> {
    conn.execute("DELETE FROM budgets WHERE id = ?1", params![id])?;
    Ok(())
}

/// The per-period budget for a category effective on `on_date` (latest budget
/// whose effective_from <= on_date).
fn current_budget(conn: &Connection, category_id: i64, on_date: &str) -> AppResult<f64> {
    let amt: Option<f64> = conn
        .query_row(
            "SELECT amount FROM budgets WHERE category_id = ?1 AND effective_from <= ?2
             ORDER BY effective_from DESC LIMIT 1",
            params![category_id, on_date],
            |r| r.get(0),
        )
        .optional()?;
    Ok(amt.unwrap_or(0.0))
}

// ----------------------------------------------------------------------------
// Accounts
// ----------------------------------------------------------------------------

pub fn accounts_list(conn: &Connection) -> AppResult<Vec<Account>> {
    let mut stmt =
        conn.prepare("SELECT id, name, connection, enabled FROM accounts ORDER BY name")?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Account {
                id: r.get(0)?,
                name: r.get(1)?,
                connection: r.get(2)?,
                enabled: r.get::<_, i64>(3)? != 0,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn account_upsert(
    conn: &Connection,
    id: &str,
    name: &str,
    connection: Option<&str>,
) -> AppResult<()> {
    conn.execute(
        "INSERT INTO accounts (id, name, connection, enabled) VALUES (?1, ?2, ?3, 1)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, connection = excluded.connection",
        params![id, name, connection],
    )?;
    Ok(())
}

pub fn account_set_enabled(conn: &Connection, id: &str, enabled: bool) -> AppResult<()> {
    conn.execute(
        "UPDATE accounts SET enabled = ?2 WHERE id = ?1",
        params![id, enabled as i64],
    )?;
    Ok(())
}

// ----------------------------------------------------------------------------
// Merchant map (auto-categorisation)
// ----------------------------------------------------------------------------

pub fn map_list(conn: &Connection) -> AppResult<Vec<MerchantMap>> {
    let mut stmt =
        conn.prepare("SELECT id, field, pattern, category_id FROM merchant_map ORDER BY pattern")?;
    let rows = stmt
        .query_map([], |r| {
            Ok(MerchantMap {
                id: r.get(0)?,
                field: r.get(1)?,
                pattern: r.get(2)?,
                category_id: r.get(3)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn map_upsert(
    conn: &Connection,
    field: &str,
    pattern: &str,
    category_id: i64,
) -> AppResult<()> {
    if !matches!(field, "merchant" | "description" | "desckey") {
        return Err(AppError::msg("map field must be 'merchant', 'description' or 'desckey'"));
    }
    conn.execute(
        "INSERT INTO merchant_map (field, pattern, category_id) VALUES (?1, ?2, ?3)
         ON CONFLICT(field, pattern) DO UPDATE SET category_id = excluded.category_id",
        params![field, pattern, category_id],
    )?;
    Ok(())
}

pub fn map_delete(conn: &Connection, id: i64) -> AppResult<()> {
    conn.execute("DELETE FROM merchant_map WHERE id = ?1", params![id])?;
    Ok(())
}

/// Apply every mapping to currently-uncategorised transactions, marking each
/// auto-applied row `suggested` so the UI can offer confirm/reject. Merchant maps
/// match exact (case-insensitive) merchant name; `desckey` maps match the
/// normalised description key; `description` maps match on substring.
pub fn apply_maps(conn: &Connection) -> AppResult<usize> {
    let maps = map_list(conn)?;
    let mut updated = 0usize;

    // merchant + description maps: set-based updates.
    for m in maps.iter().filter(|m| m.field != "desckey") {
        updated += if m.field == "merchant" {
            conn.execute(
                "UPDATE transactions SET user_category_id = ?1, suggested = 1
                 WHERE user_category_id IS NULL AND merchant_name = ?2 COLLATE NOCASE",
                params![m.category_id, m.pattern],
            )?
        } else {
            conn.execute(
                "UPDATE transactions SET user_category_id = ?1, suggested = 1
                 WHERE user_category_id IS NULL AND description LIKE ?2 COLLATE NOCASE",
                params![m.category_id, format!("%{}%", m.pattern)],
            )?
        };
    }

    // desckey maps: compute each uncategorised row's key in Rust and match exactly.
    let desckey_maps: std::collections::HashMap<String, i64> = maps
        .iter()
        .filter(|m| m.field == "desckey")
        .map(|m| (m.pattern.clone(), m.category_id))
        .collect();
    if !desckey_maps.is_empty() {
        let mut stmt = conn.prepare(
            "SELECT id, description FROM transactions
             WHERE user_category_id IS NULL AND description IS NOT NULL",
        )?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?)))?
            .collect::<Result<Vec<_>, _>>()?;
        for (id, description) in rows {
            if let Some(key) = desc_key(description.as_deref()) {
                if let Some(&cat) = desckey_maps.get(&key) {
                    updated += conn.execute(
                        "UPDATE transactions SET user_category_id = ?1, suggested = 1 WHERE id = ?2",
                        params![cat, id],
                    )?;
                }
            }
        }
    }
    Ok(updated)
}

// ----------------------------------------------------------------------------
// Recurring bills
// ----------------------------------------------------------------------------

pub fn bills_list(conn: &Connection) -> AppResult<Vec<RecurringBill>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, amount, category_id, frequency, anchor_date, active
         FROM recurring_bills ORDER BY name",
    )?;
    let rows = stmt
        .query_map([], |r| {
            Ok(RecurringBill {
                id: r.get(0)?,
                name: r.get(1)?,
                amount: r.get(2)?,
                category_id: r.get(3)?,
                frequency: r.get(4)?,
                anchor_date: r.get(5)?,
                active: r.get::<_, i64>(6)? != 0,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn bill_create(
    conn: &Connection,
    name: &str,
    amount: f64,
    category_id: Option<i64>,
    frequency: &str,
    anchor_date: &str,
) -> AppResult<i64> {
    conn.execute(
        "INSERT INTO recurring_bills (name, amount, category_id, frequency, anchor_date, active)
         VALUES (?1, ?2, ?3, ?4, ?5, 1)",
        params![name, amount, category_id, frequency, anchor_date],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn bill_update(
    conn: &Connection,
    id: i64,
    name: &str,
    amount: f64,
    category_id: Option<i64>,
    frequency: &str,
    anchor_date: &str,
    active: bool,
) -> AppResult<()> {
    conn.execute(
        "UPDATE recurring_bills SET name=?2, amount=?3, category_id=?4, frequency=?5,
             anchor_date=?6, active=?7 WHERE id=?1",
        params![id, name, amount, category_id, frequency, anchor_date, active as i64],
    )?;
    Ok(())
}

pub fn bill_delete(conn: &Connection, id: i64) -> AppResult<()> {
    conn.execute("DELETE FROM recurring_bills WHERE id = ?1", params![id])?;
    Ok(())
}

/// Materialise recurring bills as transactions up to `today`. Each occurrence
/// gets a deterministic id so repeated runs never duplicate. Bills are expenses
/// (stored as negative amounts).
pub fn materialize_bills(conn: &Connection, today: NaiveDate) -> AppResult<usize> {
    use chrono::{Duration, Months};
    let bills = bills_list(conn)?;
    let mut created = 0usize;
    for bill in bills.iter().filter(|b| b.active) {
        let anchor = match NaiveDate::parse_from_str(&bill.anchor_date, "%Y-%m-%d") {
            Ok(d) => d,
            Err(_) => continue,
        };
        let mut n: i64 = 0;
        loop {
            if n > 1040 {
                break; // safety cap (~20y weekly)
            }
            let occ = match bill.frequency.as_str() {
                "weekly" => anchor + Duration::days(7 * n),
                "fortnightly" => anchor + Duration::days(14 * n),
                "monthly" => anchor + Months::new(n as u32),
                "annual" => anchor + Months::new(12 * n as u32),
                _ => anchor + Months::new(n as u32),
            };
            if occ > today {
                break;
            }
            let occ_str = occ.format("%Y-%m-%d").to_string();
            let id = format!("recurring-{}-{}", bill.id, occ_str);
            let changed = conn.execute(
                "INSERT OR IGNORE INTO transactions
                   (id, account_id, date, amount, description, merchant_name,
                    user_category_id, source, status, edited)
                 VALUES (?1, NULL, ?2, ?3, ?4, ?5, ?6, 'recurring', 'settled', 0)",
                params![
                    id,
                    format!("{}T00:00:00Z", occ_str),
                    -bill.amount.abs(),
                    bill.name,
                    bill.name,
                    bill.category_id
                ],
            )?;
            created += changed;
            n += 1;
        }
    }
    Ok(created)
}

// ----------------------------------------------------------------------------
// Transactions
// ----------------------------------------------------------------------------

const TX_COLS: &str = "id, account_id, date, amount, description, merchant_name,
    akahu_category, user_category_id, source, status, edited, suggested, in_budget";

fn row_to_tx(r: &Row) -> rusqlite::Result<Transaction> {
    Ok(Transaction {
        id: r.get(0)?,
        account_id: r.get(1)?,
        date: r.get(2)?,
        amount: r.get(3)?,
        description: r.get(4)?,
        merchant_name: r.get(5)?,
        akahu_category: r.get(6)?,
        user_category_id: r.get(7)?,
        source: r.get(8)?,
        status: r.get(9)?,
        edited: r.get::<_, i64>(10)? != 0,
        suggested: r.get::<_, i64>(11)? != 0,
        in_budget: r.get::<_, i64>(12)? != 0,
    })
}

/// SQL fragment excluding transactions from disabled accounts.
const ACCT_FILTER: &str =
    "(account_id IS NULL OR account_id NOT IN (SELECT id FROM accounts WHERE enabled = 0))";

/// Transactions within the pay period containing `on_date`. When `show_transfers`
/// is false, rows already categorised as a transfer-type category are hidden
/// (uncategorised rows are always shown).
pub fn transactions_in_period(
    conn: &Connection,
    settings: &Settings,
    on_date: NaiveDate,
    show_transfers: bool,
) -> AppResult<Vec<Transaction>> {
    let (start, end) = period::period_bounds_str(settings, on_date);
    let transfer_clause = if show_transfers {
        ""
    } else {
        "AND (user_category_id IS NULL OR user_category_id NOT IN
              (SELECT id FROM categories WHERE kind = 'transfer'))"
    };
    let sql = format!(
        "SELECT {cols} FROM transactions
         WHERE substr(date,1,10) >= ?1 AND substr(date,1,10) < ?2
           AND {acct} {transfer}
         ORDER BY date DESC",
        cols = TX_COLS,
        acct = ACCT_FILTER,
        transfer = transfer_clause
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map(params![start, end], row_to_tx)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// All transactions (most recent 1000), ignoring the pay period — used by the
/// Transactions tab's "All" view to confirm everything pulled is logged.
pub fn transactions_all(conn: &Connection, show_transfers: bool) -> AppResult<Vec<Transaction>> {
    let transfer_clause = if show_transfers {
        ""
    } else {
        "AND (user_category_id IS NULL OR user_category_id NOT IN
              (SELECT id FROM categories WHERE kind = 'transfer'))"
    };
    let sql = format!(
        "SELECT {cols} FROM transactions
         WHERE {acct} {transfer}
         ORDER BY date DESC LIMIT 1000",
        cols = TX_COLS,
        acct = ACCT_FILTER,
        transfer = transfer_clause
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], row_to_tx)?.collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Set a category by hand. This is a confirmed choice, so it clears `suggested`.
pub fn transaction_set_category(
    conn: &Connection,
    id: &str,
    category_id: Option<i64>,
) -> AppResult<()> {
    conn.execute(
        "UPDATE transactions SET user_category_id = ?2, suggested = 0 WHERE id = ?1",
        params![id, category_id],
    )?;
    Ok(())
}

/// Confirm an auto-suggested category (keeps the category, drops the badge).
pub fn transaction_confirm(conn: &Connection, id: &str) -> AppResult<()> {
    conn.execute("UPDATE transactions SET suggested = 0 WHERE id = ?1", params![id])?;
    Ok(())
}

/// Reject an auto-suggested category: back to uncategorised, and remove the map
/// entry that produced the wrong suggestion so it won't recur.
pub fn transaction_reject(conn: &Connection, id: &str) -> AppResult<()> {
    let row: Option<(Option<String>, Option<String>)> = conn
        .query_row(
            "SELECT merchant_name, description FROM transactions WHERE id = ?1",
            params![id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    if let Some((merchant, description)) = row {
        if let Some(m) = merchant.as_deref() {
            conn.execute(
                "DELETE FROM merchant_map WHERE field='merchant' AND pattern = ?1 COLLATE NOCASE",
                params![m],
            )?;
        } else if let Some(k) = desc_key(description.as_deref()) {
            conn.execute(
                "DELETE FROM merchant_map WHERE field='desckey' AND pattern = ?1",
                params![k],
            )?;
        }
    }
    conn.execute(
        "UPDATE transactions SET user_category_id = NULL, suggested = 0 WHERE id = ?1",
        params![id],
    )?;
    Ok(())
}

/// The fields used to learn an auto-category from a transaction: its merchant
/// (preferred) or, failing that, a normalised description key.
pub fn transaction_learn_key(conn: &Connection, id: &str) -> AppResult<Option<(String, String)>> {
    let row: Option<(Option<String>, Option<String>)> = conn
        .query_row(
            "SELECT merchant_name, description FROM transactions WHERE id = ?1",
            params![id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    let (merchant, description) = match row {
        Some(v) => v,
        None => return Ok(None),
    };
    if let Some(m) = merchant.filter(|s| !s.trim().is_empty()) {
        Ok(Some(("merchant".into(), m)))
    } else if let Some(k) = desc_key(description.as_deref()) {
        Ok(Some(("desckey".into(), k)))
    } else {
        Ok(None)
    }
}

/// Edit any user-facing field. Marks the row `edited` so sync won't overwrite it.
pub fn transaction_edit(
    conn: &Connection,
    id: &str,
    date: &str,
    amount: f64,
    description: Option<&str>,
    merchant_name: Option<&str>,
    category_id: Option<i64>,
) -> AppResult<()> {
    let n = conn.execute(
        "UPDATE transactions SET date=?2, amount=?3, description=?4, merchant_name=?5,
             user_category_id=?6, edited=1 WHERE id=?1",
        params![id, date, amount, description, merchant_name, category_id],
    )?;
    if n == 0 {
        return Err(AppError::msg("transaction not found"));
    }
    Ok(())
}

/// Restore an edited Akahu transaction from its stored raw bank record.
pub fn transaction_reset(conn: &Connection, id: &str) -> AppResult<()> {
    let raw: Option<String> = conn
        .query_row("SELECT raw_json FROM transactions WHERE id = ?1", params![id], |r| r.get(0))
        .optional()?
        .flatten();
    let raw = raw.ok_or_else(|| AppError::msg("no bank data to reset to (manual transaction)"))?;
    let v: serde_json::Value = serde_json::from_str(&raw)?;
    let (date, amount, description, merchant, category) = extract_akahu_fields(&v);
    conn.execute(
        "UPDATE transactions SET date=?2, amount=?3, description=?4, merchant_name=?5,
             akahu_category=?6, edited=0 WHERE id=?1",
        params![id, date, amount, description, merchant, category],
    )?;
    Ok(())
}

pub fn transaction_delete(conn: &Connection, id: &str) -> AppResult<()> {
    // Only manual/recurring rows may be deleted; bank rows come back on next sync.
    let n = conn.execute(
        "DELETE FROM transactions WHERE id = ?1 AND source IN ('manual','recurring')",
        params![id],
    )?;
    if n == 0 {
        return Err(AppError::msg("only manual transactions can be deleted"));
    }
    Ok(())
}

/// Count transactions dated strictly before `cutoff` (YYYY-MM-DD) — used to
/// preview how many rows a trim would remove.
pub fn transactions_trim_count(conn: &Connection, cutoff: &str) -> AppResult<i64> {
    Ok(conn.query_row(
        "SELECT COUNT(*) FROM transactions WHERE substr(date,1,10) < ?1",
        params![cutoff],
        |r| r.get(0),
    )?)
}

/// Permanently delete transactions dated strictly before `cutoff` (YYYY-MM-DD),
/// to keep the store lean. Bank rows within a sync window can be re-pulled;
/// manual/recurring rows are gone for good. Returns how many were removed.
pub fn transactions_trim(conn: &Connection, cutoff: &str) -> AppResult<usize> {
    Ok(conn.execute(
        "DELETE FROM transactions WHERE substr(date,1,10) < ?1",
        params![cutoff],
    )?)
}

/// Add a manual transaction (cash / other-card spend or income).
pub fn manual_add(
    conn: &Connection,
    date: &str,
    amount: f64,
    description: Option<&str>,
    merchant_name: Option<&str>,
    category_id: Option<i64>,
) -> AppResult<Transaction> {
    let id = gen_id("manual");
    conn.execute(
        "INSERT INTO transactions
           (id, account_id, date, amount, description, merchant_name, user_category_id,
            source, status, edited)
         VALUES (?1, NULL, ?2, ?3, ?4, ?5, ?6, 'manual', 'settled', 0)",
        params![id, date, amount, description, merchant_name, category_id],
    )?;
    Ok(Transaction {
        id,
        account_id: None,
        date: date.into(),
        amount,
        description: description.map(String::from),
        merchant_name: merchant_name.map(String::from),
        akahu_category: None,
        user_category_id: category_id,
        source: "manual".into(),
        status: "settled".into(),
        edited: false,
        suggested: false,
        in_budget: true,
    })
}

/// Toggle whether a transaction counts toward dashboard budgets.
pub fn transaction_set_in_budget(conn: &Connection, id: &str, in_budget: bool) -> AppResult<()> {
    conn.execute(
        "UPDATE transactions SET in_budget = ?2 WHERE id = ?1",
        params![id, in_budget as i64],
    )?;
    Ok(())
}

pub fn transactions_count(conn: &Connection) -> AppResult<i64> {
    Ok(conn.query_row("SELECT COUNT(*) FROM transactions", [], |r| r.get(0))?)
}

// ---- Sync reconciliation helpers ------------------------------------------

/// Upsert a settled Akahu transaction. Preserves the user's category and never
/// touches a row the user has edited. Returns (inserted, updated).
pub fn upsert_settled(
    conn: &Connection,
    id: &str,
    account_id: Option<&str>,
    date: &str,
    amount: f64,
    description: Option<&str>,
    merchant: Option<&str>,
    category: Option<&str>,
    raw_json: &str,
) -> AppResult<(bool, bool)> {
    // Leave edited rows completely alone.
    let is_edited: Option<i64> = conn
        .query_row("SELECT edited FROM transactions WHERE id = ?1", params![id], |r| r.get(0))
        .optional()?;
    if is_edited == Some(1) {
        return Ok((false, false));
    }
    let existed = is_edited.is_some();
    conn.execute(
        "INSERT INTO transactions
           (id, account_id, date, amount, description, merchant_name, akahu_category,
            source, status, edited, raw_json)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'akahu', 'settled', 0, ?8)
         ON CONFLICT(id) DO UPDATE SET
            account_id=excluded.account_id, date=excluded.date, amount=excluded.amount,
            description=excluded.description, merchant_name=excluded.merchant_name,
            akahu_category=excluded.akahu_category, status='settled', raw_json=excluded.raw_json",
        params![id, account_id, date, amount, description, merchant, category, raw_json],
    )?;
    Ok((!existed, existed))
}


/// True if a settled row already exists with the same amount AND the same
/// (non-empty) merchant within a couple of days — the guard against showing a
/// pending copy of a charge that already settled. Crucially this only fires when
/// there is a real merchant to match on: matching on amount alone (the common
/// case where Akahu gives no merchant) would wrongly drop distinct transactions.
pub fn settled_duplicate_exists(
    conn: &Connection,
    amount: f64,
    merchant: Option<&str>,
    date: &str,
) -> AppResult<bool> {
    let merchant = match merchant {
        Some(m) if !m.trim().is_empty() => m,
        _ => return Ok(false),
    };
    let day = date.get(0..10).unwrap_or(date);
    let dup: i64 = conn.query_row(
        "SELECT COUNT(*) FROM transactions
         WHERE status='settled' AND amount = ?1
           AND merchant_name = ?2 COLLATE NOCASE
           AND ABS(julianday(substr(date,1,10)) - julianday(?3)) <= 2",
        params![amount, merchant, day],
        |r| r.get(0),
    )?;
    Ok(dup > 0)
}

/// Upsert a pending Akahu transaction. Like the settled path, `ON CONFLICT` never
/// touches `user_category_id`, so a category you assigned to a pending row
/// survives re-syncs. Edited rows are left untouched.
pub fn upsert_pending(
    conn: &Connection,
    id: &str,
    account_id: Option<&str>,
    date: &str,
    amount: f64,
    description: Option<&str>,
    merchant: Option<&str>,
    category: Option<&str>,
    raw_json: &str,
) -> AppResult<()> {
    let is_edited: Option<i64> = conn
        .query_row("SELECT edited FROM transactions WHERE id = ?1", params![id], |r| r.get(0))
        .optional()?;
    if is_edited == Some(1) {
        return Ok(());
    }
    conn.execute(
        "INSERT INTO transactions
           (id, account_id, date, amount, description, merchant_name, akahu_category,
            source, status, edited, raw_json)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'akahu', 'pending', 0, ?8)
         ON CONFLICT(id) DO UPDATE SET
            account_id=excluded.account_id, date=excluded.date, amount=excluded.amount,
            description=excluded.description, merchant_name=excluded.merchant_name,
            akahu_category=excluded.akahu_category, status='pending', raw_json=excluded.raw_json",
        params![id, account_id, date, amount, description, merchant, category, raw_json],
    )?;
    Ok(())
}

/// Delete Akahu pending rows whose id is no longer returned (they settled or
/// vanished). Never deletes edited rows. Returns count.
pub fn delete_missing_pending(conn: &Connection, keep_ids: &[String]) -> AppResult<usize> {
    let mut stmt = conn
        .prepare("SELECT id FROM transactions WHERE source='akahu' AND status='pending' AND edited=0")?;
    let local_ids =
        stmt.query_map([], |r| r.get::<_, String>(0))?.collect::<Result<Vec<_>, _>>()?;
    let keep: std::collections::HashSet<&str> = keep_ids.iter().map(String::as_str).collect();
    let mut deleted = 0usize;
    for id in local_ids {
        if !keep.contains(id.as_str()) {
            deleted += conn.execute("DELETE FROM transactions WHERE id = ?1", params![id])?;
        }
    }
    Ok(deleted)
}

/// When a pending transaction settles into a new row, carry over the category the
/// user gave the pending copy. Matches on amount + merchant within a few days.
/// Run while pending rows still exist (before pending reconciliation).
pub fn inherit_pending_categories(conn: &Connection) -> AppResult<usize> {
    Ok(conn.execute(
        "UPDATE transactions AS s SET user_category_id = (
            SELECT p.user_category_id FROM transactions p
            WHERE p.status='pending' AND p.user_category_id IS NOT NULL
              AND p.amount = s.amount
              AND IFNULL(p.merchant_name,'') = IFNULL(s.merchant_name,'')
              AND ABS(julianday(substr(p.date,1,10)) - julianday(substr(s.date,1,10))) <= 4
            LIMIT 1)
         WHERE s.source='akahu' AND s.status='settled' AND s.edited=0
           AND s.user_category_id IS NULL
           AND EXISTS (
            SELECT 1 FROM transactions p
            WHERE p.status='pending' AND p.user_category_id IS NOT NULL
              AND p.amount = s.amount
              AND IFNULL(p.merchant_name,'') = IFNULL(s.merchant_name,'')
              AND ABS(julianday(substr(p.date,1,10)) - julianday(substr(s.date,1,10))) <= 4)",
        [],
    )?)
}

// ----------------------------------------------------------------------------
// Sync state
// ----------------------------------------------------------------------------

pub fn sync_state_get(conn: &Connection) -> AppResult<SyncState> {
    Ok(conn.query_row(
        "SELECT last_sync_at, last_run_status FROM sync_state WHERE id = 1",
        [],
        |r| Ok(SyncState { last_sync_at: r.get(0)?, last_run_status: r.get(1)? }),
    )?)
}

pub fn sync_state_set(conn: &Connection, last_sync_at: &str, status: &str) -> AppResult<()> {
    conn.execute(
        "UPDATE sync_state SET last_sync_at=?1, last_run_status=?2 WHERE id=1",
        params![last_sync_at, status],
    )?;
    Ok(())
}

pub fn sync_status_set(conn: &Connection, status: &str) -> AppResult<()> {
    conn.execute("UPDATE sync_state SET last_run_status=?1 WHERE id=1", params![status])?;
    Ok(())
}

// ----------------------------------------------------------------------------
// Dashboard aggregation
// ----------------------------------------------------------------------------

/// Sum of transaction amounts for a category within [start,end), honouring the
/// disabled-account filter. Positive = net inflow, negative = net outflow.
fn category_amount_sum(
    conn: &Connection,
    category_id: i64,
    start: &str,
    end: &str,
) -> AppResult<f64> {
    let sql = format!(
        "SELECT COALESCE(SUM(amount),0) FROM transactions
         WHERE user_category_id = ?1 AND substr(date,1,10) >= ?2 AND substr(date,1,10) < ?3
           AND in_budget = 1 AND {acct}",
        acct = ACCT_FILTER
    );
    Ok(conn.query_row(&sql, params![category_id, start, end], |r| r.get(0))?)
}

/// Total outgoing (negated) for a category since `since` (for envelope balance).
fn category_spend_since(conn: &Connection, category_id: i64, since: &str) -> AppResult<f64> {
    let sql = format!(
        "SELECT COALESCE(-SUM(amount),0) FROM transactions
         WHERE user_category_id = ?1 AND substr(date,1,10) >= ?2 AND in_budget = 1 AND {acct}",
        acct = ACCT_FILTER
    );
    Ok(conn.query_row(&sql, params![category_id, since], |r| r.get(0))?)
}

/// Resolve the dashboard's date window. With an explicit inclusive range
/// (`range_start`..`range_end`) it returns those bounds (end made exclusive) plus
/// the range end as the "as of" date for rollover accrual; otherwise it falls back
/// to the natural pay period containing `today`.
fn dashboard_bounds(
    settings: &Settings,
    today: NaiveDate,
    range_start: Option<&str>,
    range_end: Option<&str>,
) -> (String, String, NaiveDate) {
    match (range_start, range_end) {
        (Some(s), Some(e)) => {
            let as_of = NaiveDate::parse_from_str(e, "%Y-%m-%d").unwrap_or(today);
            let end_excl = (as_of + Duration::days(1)).format("%Y-%m-%d").to_string();
            (s.to_string(), end_excl, as_of)
        }
        _ => {
            let (s, e) = period::period_bounds_str(settings, today);
            (s, e, today)
        }
    }
}

pub fn dashboard(
    conn: &Connection,
    settings: &Settings,
    today: NaiveDate,
    range_start: Option<&str>,
    range_end: Option<&str>,
) -> AppResult<DashboardSummary> {
    let (start, end, as_of) = dashboard_bounds(settings, today, range_start, range_end);
    let categories = categories_list(conn)?;

    let mut rows = Vec::new();
    let mut income = 0.0;
    let mut expense_spent = 0.0; // actual spend of ALL expense categories (rollover included)
    let mut rollover_budget = 0.0; // budgeted allocation of rollover funds (informational only)

    for c in &categories {
        let net = category_amount_sum(conn, c.id, &start, &end)?;
        let budget = current_budget(conn, c.id, &end)?;

        let (spent, envelope) = match c.kind.as_str() {
            "income" => {
                income += net; // net inflow counts as income
                (0.0, 0.0)
            }
            "transfer" => (0.0, 0.0), // excluded entirely
            _ => {
                // expense: spent is outgoing, refunds (positive) net against it.
                // Every expense category counts toward the period's total spend now
                // (the headline is a true net balance = income − all expenses).
                let spent = -net;
                expense_spent += spent;
                if c.rollover {
                    // Still surfaced in the "Set aside" card + envelope, but no longer
                    // subtracted from the headline.
                    rollover_budget += budget;
                    let since = c.rollover_start.clone().unwrap_or_else(|| start.clone());
                    let elapsed = period::period_index(settings, as_of)
                        - period::period_index(
                            settings,
                            NaiveDate::parse_from_str(&since, "%Y-%m-%d").unwrap_or(as_of),
                        )
                        + 1;
                    let total_spend = category_spend_since(conn, c.id, &since)?;
                    let envelope = elapsed.max(0) as f64 * budget - total_spend;
                    (spent, envelope)
                } else {
                    (spent, 0.0)
                }
            }
        };

        rows.push(DashboardRow {
            category_id: Some(c.id),
            category_name: c.name.clone(),
            color: c.color.clone(),
            kind: c.kind.clone(),
            rollover: c.rollover,
            budget,
            spent,
            envelope_balance: envelope,
        });
    }

    let uncategorized_count: i64 = {
        let sql = format!(
            "SELECT COUNT(*) FROM transactions
             WHERE user_category_id IS NULL AND substr(date,1,10) >= ?1
               AND substr(date,1,10) < ?2 AND in_budget = 1 AND {acct}",
            acct = ACCT_FILTER
        );
        conn.query_row(&sql, params![start, end], |r| r.get(0))?
    };

    // Net balance = total income − total expenses. Rollover budget is reported
    // separately (Set aside) and no longer reduces this figure.
    let surplus = income - expense_spent;

    Ok(DashboardSummary {
        period_start: start,
        period_end: end,
        income,
        expense_spent,
        rollover_budget,
        surplus,
        rows,
        uncategorized_count,
    })
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

fn today_str() -> String {
    chrono::Local::now().date_naive().format("%Y-%m-%d").to_string()
}

/// Convert an Akahu UTC timestamp to the machine's local date-time, so a
/// transaction is bucketed on the day it happened *locally* (NZ is UTC+12, so a
/// morning purchase has a previous-day UTC date). Falls back to the raw string.
fn to_local_datetime(iso: &str) -> String {
    match chrono::DateTime::parse_from_rfc3339(iso) {
        Ok(dt) => dt.with_timezone(&chrono::Local).format("%Y-%m-%dT%H:%M:%S").to_string(),
        Err(_) => iso.to_string(),
    }
}

/// Extract (date, amount, description, merchant, category) from a raw Akahu tx.
/// `date` is converted to local time so period/day bucketing is correct.
pub fn extract_akahu_fields(
    v: &serde_json::Value,
) -> (String, f64, Option<String>, Option<String>, Option<String>) {
    let date = v
        .get("date")
        .and_then(|x| x.as_str())
        .map(to_local_datetime)
        .unwrap_or_default();
    let amount = v.get("amount").and_then(|x| x.as_f64()).unwrap_or(0.0);
    let description = v.get("description").and_then(|x| x.as_str()).map(String::from);
    let merchant = v
        .get("merchant")
        .and_then(|m| m.get("name"))
        .and_then(|x| x.as_str())
        .map(String::from);
    let category = v
        .get("category")
        .and_then(|c| c.get("name"))
        .and_then(|x| x.as_str())
        .map(String::from);
    (date, amount, description, merchant, category)
}
