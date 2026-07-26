use chrono::{DateTime, Duration, Local, NaiveDate, SecondsFormat, Utc};

use crate::akahu::AkahuClient;
use crate::db::{self, Db};
use crate::error::AppResult;
use crate::models::SyncResult;

/// Overlap re-pulled before the last sync so late-settling transactions are
/// never missed. De-dup on id makes the overlap harmless.
const OVERLAP_DAYS: i64 = 3;

/// Pull settled + pending transactions from Akahu and reconcile them into the
/// local store without ever creating duplicates. Tokens come from the cached
/// credentials (resolved by the caller) to avoid extra Keychain reads.
///
/// `override_start` forces the fetch window (ISO-8601) — used by "Full resync" to
/// backfill a long history. When None, the normal incremental window is used.
pub async fn run_sync(
    db: &Db,
    app_token: String,
    user_token: String,
    override_start: Option<String>,
    force_refresh: bool,
) -> AppResult<SyncResult> {
    let today = Local::now().date_naive();

    // Window: override (full resync) → first sync → last sync − overlap.
    let start_rfc = if let Some(s) = override_start {
        s
    } else {
        let conn = db.0.lock().unwrap();
        let state = db::sync_state_get(&conn)?;
        let settings = db::get_settings(&conn)?;
        match state.last_sync_at.as_deref().and_then(|s| DateTime::parse_from_rfc3339(s).ok()) {
            Some(dt) => {
                let base = dt.with_timezone(&Utc) - Duration::days(OVERLAP_DAYS);
                base.to_rfc3339_opts(SecondsFormat::Millis, true)
            }
            None => {
                let ps = crate::period::period_start(&settings, today);
                // Fetch from a day before the period start: UTC midnight is local
                // midday in NZ, so a straight period-start boundary would miss that
                // morning's transactions. Dedup by id makes the extra day harmless.
                let fetch_from = ps - Duration::days(1);
                format!("{}T00:00:00.000Z", fetch_from.format("%Y-%m-%d"))
            }
        }
    };

    let client = AkahuClient::new(app_token, user_token);

    // Optionally force Akahu to re-poll the bank before we pull, so same-day
    // transactions land sooner than Akahu's scheduled refresh would deliver them.
    // Best-effort: a rate-limited or failed refresh must not abort the sync.
    if force_refresh {
        if let Err(e) = force_bank_refresh(&client).await {
            eprintln!("bank refresh skipped: {e}");
        }
    }

    // Network phase — no DB lock held across awaits.
    let accounts = client.accounts().await?;
    let settled = client.transactions_since(&start_rfc).await?;
    let pending = client.transactions_pending().await?;
    let now = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);

    // Write phase — single lock, no awaits inside.
    let (mut inserted, mut updated, mut deleted, mut pending_kept) = (0usize, 0usize, 0usize, 0usize);
    let total;
    {
        let conn = db.0.lock().unwrap();

        for acc in &accounts {
            db::account_upsert(&conn, &acc.id, &acc.name, acc.connection.as_deref())?;
        }

        // Settled: additive upsert ONLY — never delete. Losing a real transaction
        // is far worse than a rare stray duplicate from Akahu's delete/replace,
        // which the user can remove by hand.
        for item in &settled {
            let id = match item.get("_id").and_then(|v| v.as_str()) {
                Some(s) => s.to_string(),
                None => continue,
            };
            let account_id = item.get("_account").and_then(|v| v.as_str());
            let (date, amount, description, merchant, category) = db::extract_akahu_fields(item);
            if date.is_empty() {
                continue;
            }
            let (ins, upd) = db::upsert_settled(
                &conn,
                &id,
                account_id,
                &date,
                amount,
                description.as_deref(),
                merchant.as_deref(),
                category.as_deref(),
                &item.to_string(),
            )?;
            inserted += ins as usize;
            updated += upd as usize;
        }

        // Carry any category from a pending row onto its freshly-settled version
        // (must run while the pending rows still exist).
        db::inherit_pending_categories(&conn)?;

        // Pending: upsert by id (preserving the user's category), then delete any
        // pending rows whose id Akahu no longer returns (settled or vanished).
        let mut pending_keep: Vec<String> = Vec::with_capacity(pending.len());
        for item in &pending {
            let id = item
                .get("_id")
                .and_then(|v| v.as_str())
                .map(String::from)
                .unwrap_or_else(|| synth_pending_id(item));
            let account_id = item.get("_account").and_then(|v| v.as_str());
            let (date, amount, description, merchant, category) = db::extract_akahu_fields(item);
            if date.is_empty() {
                continue;
            }
            // Guard: skip a pending copy of a charge that already settled.
            if db::settled_duplicate_exists(&conn, amount, merchant.as_deref(), &date)? {
                continue;
            }
            db::upsert_pending(
                &conn,
                &id,
                account_id,
                &date,
                amount,
                description.as_deref(),
                merchant.as_deref(),
                category.as_deref(),
                &item.to_string(),
            )?;
            pending_keep.push(id);
            pending_kept += 1;
        }
        // Only reconcile-delete pending when we actually received a pending list.
        // A transient empty response must never wipe stored pending rows.
        if !pending.is_empty() {
            deleted += db::delete_missing_pending(&conn, &pending_keep)?;
        }

        db::apply_maps(&conn)?;
        db::materialize_bills(&conn, today)?;

        let status = format!(
            "{inserted} new, {updated} updated, {deleted} removed, {pending_kept} pending"
        );
        db::sync_state_set(&conn, &now, &status)?;
        total = db::transactions_count(&conn)?;
    }

    Ok(SyncResult {
        inserted,
        updated,
        deleted,
        pending: pending_kept,
        total_transactions: total,
        last_sync_at: now,
    })
}

/// Ask Akahu to re-poll the bank now, then wait (up to ~24s) for the refreshed
/// data to actually land — detected by each account's `refreshed.transactions`
/// timestamp advancing past what it was before. If the timestamps never advance
/// (bank slow, or field absent) we return after the timeout and let the pull run
/// with whatever is available.
async fn force_bank_refresh(client: &AkahuClient) -> AppResult<()> {
    let baseline = max_refreshed(&client.accounts().await?);
    client.refresh().await?;
    for _ in 0..8 {
        tokio::time::sleep(std::time::Duration::from_secs(3)).await;
        let latest = max_refreshed(&client.accounts().await?);
        // ISO-8601 UTC timestamps sort lexically, so a plain `>` is a valid
        // "has it advanced?" check; a first-ever timestamp (None → Some) counts.
        if latest > baseline {
            break;
        }
    }
    Ok(())
}

/// The most recent `refreshed_at` across accounts, if any.
fn max_refreshed(accounts: &[crate::akahu::AkahuAccount]) -> Option<String> {
    accounts.iter().filter_map(|a| a.refreshed_at.clone()).max()
}

/// Pending transactions may lack a stable `_id`; derive a deterministic fallback
/// so the same pending item maps to the same row within a sync.
fn synth_pending_id(item: &serde_json::Value) -> String {
    let date = item.get("date").and_then(|v| v.as_str()).unwrap_or("");
    let amount = item.get("amount").and_then(|v| v.as_f64()).unwrap_or(0.0);
    let desc = item.get("description").and_then(|v| v.as_str()).unwrap_or("");
    format!("pending-{date}-{amount}-{desc}")
}

/// Ensure any recurring bills due up to today exist (called on app startup too).
pub fn materialize_due(db: &Db) -> AppResult<usize> {
    let today: NaiveDate = Local::now().date_naive();
    let conn = db.0.lock().unwrap();
    db::materialize_bills(&conn, today)
}
