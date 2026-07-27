use chrono::Local;
use tauri::State;

use crate::akahu::AkahuClient;
use crate::db::{self, Db};
use crate::error::AppResult;
use crate::models::*;
use crate::secrets::Creds;
use crate::sync;

fn today() -> chrono::NaiveDate {
    Local::now().date_naive()
}

// ---- Settings -------------------------------------------------------------

#[tauri::command]
pub fn get_settings(db: State<'_, Db>) -> AppResult<Settings> {
    db::get_settings(&db.0.lock().unwrap())
}

#[tauri::command]
pub fn set_settings(
    db: State<'_, Db>,
    income_period: String,
    income_day: i64,
    income_anchor: Option<String>,
) -> AppResult<()> {
    db::set_settings(&db.0.lock().unwrap(), &Settings { income_period, income_day, income_anchor })
}

// ---- Categories -----------------------------------------------------------

#[tauri::command]
pub fn categories_list(db: State<'_, Db>) -> AppResult<Vec<Category>> {
    db::categories_list(&db.0.lock().unwrap())
}

#[tauri::command]
pub fn category_create(
    db: State<'_, Db>,
    name: String,
    color: String,
    kind: String,
    rollover: bool,
) -> AppResult<Category> {
    db::category_create(&db.0.lock().unwrap(), &name, &color, &kind, rollover)
}

#[tauri::command]
pub fn category_update(
    db: State<'_, Db>,
    id: i64,
    name: String,
    color: String,
    sort_order: i64,
    kind: String,
    rollover: bool,
) -> AppResult<()> {
    db::category_update(&db.0.lock().unwrap(), id, &name, &color, sort_order, &kind, rollover)
}

#[tauri::command]
pub fn category_delete(db: State<'_, Db>, id: i64) -> AppResult<()> {
    db::category_delete(&db.0.lock().unwrap(), id)
}

// ---- Budgets --------------------------------------------------------------

#[tauri::command]
pub fn budgets_list(db: State<'_, Db>) -> AppResult<Vec<Budget>> {
    db::budgets_list(&db.0.lock().unwrap())
}

#[tauri::command]
pub fn budget_set(
    db: State<'_, Db>,
    category_id: i64,
    amount: f64,
    effective_from: String,
) -> AppResult<()> {
    db::budget_set(&db.0.lock().unwrap(), category_id, amount, &effective_from)
}

#[tauri::command]
pub fn budget_delete(db: State<'_, Db>, id: i64) -> AppResult<()> {
    db::budget_delete(&db.0.lock().unwrap(), id)
}

// ---- Accounts -------------------------------------------------------------

#[tauri::command]
pub fn accounts_list(db: State<'_, Db>) -> AppResult<Vec<Account>> {
    db::accounts_list(&db.0.lock().unwrap())
}

#[tauri::command]
pub fn account_set_enabled(db: State<'_, Db>, id: String, enabled: bool) -> AppResult<()> {
    db::account_set_enabled(&db.0.lock().unwrap(), &id, enabled)
}

// ---- Merchant map ---------------------------------------------------------

#[tauri::command]
pub fn map_list(db: State<'_, Db>) -> AppResult<Vec<MerchantMap>> {
    db::map_list(&db.0.lock().unwrap())
}

#[tauri::command]
pub fn map_delete(db: State<'_, Db>, id: i64) -> AppResult<()> {
    db::map_delete(&db.0.lock().unwrap(), id)
}

// ---- Recurring bills ------------------------------------------------------

#[tauri::command]
pub fn bills_list(db: State<'_, Db>) -> AppResult<Vec<RecurringBill>> {
    db::bills_list(&db.0.lock().unwrap())
}

#[tauri::command]
pub fn bill_create(
    db: State<'_, Db>,
    name: String,
    amount: f64,
    category_id: Option<i64>,
    frequency: String,
    anchor_date: String,
) -> AppResult<i64> {
    let conn = db.0.lock().unwrap();
    let id = db::bill_create(&conn, &name, amount, category_id, &frequency, &anchor_date)?;
    db::materialize_bills(&conn, today())?;
    Ok(id)
}

#[tauri::command]
pub fn bill_update(
    db: State<'_, Db>,
    id: i64,
    name: String,
    amount: f64,
    category_id: Option<i64>,
    frequency: String,
    anchor_date: String,
    active: bool,
) -> AppResult<()> {
    db::bill_update(&db.0.lock().unwrap(), id, &name, amount, category_id, &frequency, &anchor_date, active)
}

#[tauri::command]
pub fn bill_delete(db: State<'_, Db>, id: i64) -> AppResult<()> {
    db::bill_delete(&db.0.lock().unwrap(), id)
}

// ---- Transactions ---------------------------------------------------------

#[tauri::command]
pub fn transactions_list(
    db: State<'_, Db>,
    show_transfers: bool,
    all_periods: bool,
) -> AppResult<Vec<Transaction>> {
    let conn = db.0.lock().unwrap();
    if all_periods {
        db::transactions_all(&conn, show_transfers)
    } else {
        let settings = db::get_settings(&conn)?;
        db::transactions_in_period(&conn, &settings, today(), show_transfers)
    }
}

/// Set a transaction's category. When `learn` is true and the transaction has a
/// merchant, remember merchant→category and auto-apply it to other uncategorised
/// rows. Returns how many *other* rows were auto-categorised.
#[tauri::command]
pub fn transaction_set_category(
    db: State<'_, Db>,
    id: String,
    category_id: Option<i64>,
    learn: bool,
) -> AppResult<usize> {
    let conn = db.0.lock().unwrap();
    db::transaction_set_category(&conn, &id, category_id)?;
    if learn {
        if let Some(cat) = category_id {
            if let Some((field, pattern)) = db::transaction_learn_key(&conn, &id)? {
                db::map_upsert(&conn, &field, &pattern, cat)?;
                return db::apply_maps(&conn);
            }
        }
    }
    Ok(0)
}

#[tauri::command]
pub fn transaction_confirm(db: State<'_, Db>, id: String) -> AppResult<()> {
    db::transaction_confirm(&db.0.lock().unwrap(), &id)
}

#[tauri::command]
pub fn transaction_reject(db: State<'_, Db>, id: String) -> AppResult<()> {
    db::transaction_reject(&db.0.lock().unwrap(), &id)
}

#[tauri::command]
pub fn transaction_set_in_budget(db: State<'_, Db>, id: String, in_budget: bool) -> AppResult<()> {
    db::transaction_set_in_budget(&db.0.lock().unwrap(), &id, in_budget)
}

#[tauri::command]
pub fn transaction_edit(
    db: State<'_, Db>,
    id: String,
    date: String,
    amount: f64,
    description: Option<String>,
    merchant_name: Option<String>,
    category_id: Option<i64>,
) -> AppResult<()> {
    db::transaction_edit(
        &db.0.lock().unwrap(),
        &id,
        &date,
        amount,
        description.as_deref(),
        merchant_name.as_deref(),
        category_id,
    )
}

#[tauri::command]
pub fn transaction_reset(db: State<'_, Db>, id: String) -> AppResult<()> {
    db::transaction_reset(&db.0.lock().unwrap(), &id)
}

#[tauri::command]
pub fn transaction_delete(db: State<'_, Db>, id: String) -> AppResult<()> {
    db::transaction_delete(&db.0.lock().unwrap(), &id)
}

/// Turn a "keep the last N days" choice into an ISO cutoff date. Rows strictly
/// older than this are what a trim targets.
fn trim_cutoff(keep_days: i64) -> String {
    (Local::now().date_naive() - chrono::Duration::days(keep_days))
        .format("%Y-%m-%d")
        .to_string()
}

#[tauri::command]
pub fn transactions_trim_count(db: State<'_, Db>, keep_days: i64) -> AppResult<i64> {
    db::transactions_trim_count(&db.0.lock().unwrap(), &trim_cutoff(keep_days))
}

#[tauri::command]
pub fn transactions_trim(db: State<'_, Db>, keep_days: i64) -> AppResult<usize> {
    db::transactions_trim(&db.0.lock().unwrap(), &trim_cutoff(keep_days))
}

#[tauri::command]
pub fn manual_add(
    db: State<'_, Db>,
    date: String,
    amount: f64,
    description: Option<String>,
    merchant_name: Option<String>,
    category_id: Option<i64>,
) -> AppResult<Transaction> {
    db::manual_add(
        &db.0.lock().unwrap(),
        &date,
        amount,
        description.as_deref(),
        merchant_name.as_deref(),
        category_id,
    )
}

// ---- Dashboard ------------------------------------------------------------

#[tauri::command]
pub fn dashboard(db: State<'_, Db>) -> AppResult<DashboardSummary> {
    let conn = db.0.lock().unwrap();
    let settings = db::get_settings(&conn)?;
    db::dashboard(&conn, &settings, today())
}

// ---- Sync -----------------------------------------------------------------

#[tauri::command]
pub fn sync_state_get(db: State<'_, Db>) -> AppResult<SyncState> {
    db::sync_state_get(&db.0.lock().unwrap())
}

async fn do_sync(
    db: &State<'_, Db>,
    creds: &State<'_, Creds>,
    override_start: Option<String>,
    force_refresh: bool,
) -> AppResult<SyncResult> {
    let (app_token, user_token) = creds.api()?;
    match sync::run_sync(db, app_token, user_token, override_start, force_refresh).await {
        Ok(res) => Ok(res),
        Err(e) => {
            if let Ok(conn) = db.0.lock() {
                let _ = db::sync_status_set(&conn, &format!("Failed: {e}"));
            }
            Err(e)
        }
    }
}

#[tauri::command]
pub async fn sync_now(db: State<'_, Db>, creds: State<'_, Creds>) -> AppResult<SyncResult> {
    do_sync(&db, &creds, None, false).await
}

/// Force Akahu to re-poll the bank now, wait for the fresh data to land, then
/// pull. Slower than a plain refresh (~10–25s) but surfaces same-day
/// transactions sooner than Akahu's scheduled sync would.
#[tauri::command]
pub async fn sync_from_bank(db: State<'_, Db>, creds: State<'_, Creds>) -> AppResult<SyncResult> {
    do_sync(&db, &creds, None, true).await
}

/// Backfill a long history (last ~120 days). Non-destructive, so safe to run to
/// recover transactions that an earlier version may have dropped.
#[tauri::command]
pub async fn sync_full(db: State<'_, Db>, creds: State<'_, Creds>) -> AppResult<SyncResult> {
    let since = (Local::now().date_naive() - chrono::Duration::days(120))
        .format("%Y-%m-%dT00:00:00.000Z")
        .to_string();
    do_sync(&db, &creds, Some(since), false).await
}

/// Read-only: report what Akahu currently returns (counts, newest dates, and the
/// last few transactions) without storing anything — for diagnosing missing
/// same-day transactions. Never exposes token values.
#[tauri::command]
pub async fn akahu_diagnostic(creds: State<'_, Creds>) -> AppResult<AkahuDiagnostic> {
    let (app_token, user_token) = creds.api()?;
    let client = AkahuClient::new(app_token, user_token);

    let accounts = client.accounts().await?;
    let refreshed_at = accounts.iter().filter_map(|a| a.refreshed_at.clone()).max();

    // Only need a short recent window to answer "is today's data here yet?".
    let since = (Local::now().date_naive() - chrono::Duration::days(14))
        .format("%Y-%m-%dT00:00:00.000Z")
        .to_string();
    let settled = client.transactions_since(&since).await?;
    let pending = client.transactions_pending().await?;

    let to_diag = |item: &serde_json::Value, status: &str| {
        let (date, amount, description, merchant, _cat) = db::extract_akahu_fields(item);
        DiagTx { date, amount, description, merchant, status: status.to_string() }
    };
    let settled_rows: Vec<DiagTx> = settled.iter().map(|i| to_diag(i, "settled")).collect();
    let pending_rows: Vec<DiagTx> = pending.iter().map(|i| to_diag(i, "pending")).collect();

    let newest = |rows: &[DiagTx]| rows.iter().map(|r| r.date.clone()).max();
    let newest_settled_date = newest(&settled_rows);
    let newest_pending_date = newest(&pending_rows);

    let mut recent: Vec<DiagTx> =
        settled_rows.iter().chain(pending_rows.iter()).cloned().collect();
    recent.sort_by(|a, b| b.date.cmp(&a.date));
    recent.truncate(15);

    Ok(AkahuDiagnostic {
        account_count: accounts.len(),
        refreshed_at,
        settled_count: settled_rows.len(),
        newest_settled_date,
        pending_count: pending_rows.len(),
        newest_pending_date,
        recent,
    })
}

// ---- Updates --------------------------------------------------------------

const RELEASES_URL: &str = "https://github.com/richdavies2005/spending-tracker/releases/latest";

/// Split "1.2.3" (with optional leading "v" and trailing pre-release junk) into
/// (major, minor, patch) for comparison.
fn parse_semver(v: &str) -> (u64, u64, u64) {
    let mut it = v.trim_start_matches('v').split('.').map(|p| {
        p.chars().take_while(|c| c.is_ascii_digit()).collect::<String>().parse::<u64>().unwrap_or(0)
    });
    (it.next().unwrap_or(0), it.next().unwrap_or(0), it.next().unwrap_or(0))
}

async fn fetch_latest_tag() -> AppResult<(String, String)> {
    let client = reqwest::Client::new();
    let body: serde_json::Value = client
        .get("https://api.github.com/repos/richdavies2005/spending-tracker/releases/latest")
        .header("User-Agent", "spending-tracker")
        .header("Accept", "application/vnd.github+json")
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    let tag = body.get("tag_name").and_then(|v| v.as_str()).unwrap_or_default().to_string();
    let url = body
        .get("html_url")
        .and_then(|v| v.as_str())
        .unwrap_or(RELEASES_URL)
        .to_string();
    Ok((tag, url))
}

/// Check GitHub for a newer published release. Never errors out to the UI — on any
/// network/API problem it simply reports "no update available" so the banner stays
/// hidden. `current` is the version compiled into this build.
#[tauri::command]
pub async fn check_for_update() -> UpdateInfo {
    let current = env!("CARGO_PKG_VERSION").to_string();
    match fetch_latest_tag().await {
        Ok((tag, url)) => UpdateInfo {
            available: parse_semver(&tag) > parse_semver(&current),
            latest: tag.trim_start_matches('v').to_string(),
            current,
            url,
        },
        Err(_) => UpdateInfo {
            latest: current.clone(),
            current,
            available: false,
            url: RELEASES_URL.to_string(),
        },
    }
}

// ---- Credentials ----------------------------------------------------------

#[tauri::command]
pub fn credentials_status(creds: State<'_, Creds>) -> AppResult<CredentialStatus> {
    creds.status()
}

#[tauri::command]
pub fn save_credentials(
    creds: State<'_, Creds>,
    app_token: Option<String>,
    app_secret: Option<String>,
    user_token: Option<String>,
) -> AppResult<CredentialStatus> {
    creds.save(app_token, app_secret, user_token)
}

#[tauri::command]
pub fn clear_credentials(creds: State<'_, Creds>) -> AppResult<CredentialStatus> {
    creds.clear()
}

#[tauri::command]
pub async fn akahu_validate(db: State<'_, Db>, creds: State<'_, Creds>) -> AppResult<String> {
    let (app_token, user_token) = creds.api()?;
    let client = AkahuClient::new(app_token, user_token);
    let name = client.me().await?;
    let accounts = client.accounts().await?;
    {
        let conn = db.0.lock().unwrap();
        for acc in &accounts {
            db::account_upsert(&conn, &acc.id, &acc.name, acc.connection.as_deref())?;
        }
    }
    Ok(name)
}
