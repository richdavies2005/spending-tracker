use serde::{Deserialize, Serialize};

/// App settings — drives the pay-period cycle. `income_period` is "weekly",
/// "fortnightly" or "monthly". `income_day` is an ISO weekday (1=Mon..7=Sun) for
/// weekly/fortnightly, or a day-of-month (1..31) for monthly. `income_anchor`
/// (ISO date) pins which two-week block a fortnight falls in — a fortnight, unlike
/// a week, repeats every 14 days so it needs a known reference payday. Ignored for
/// weekly/monthly.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    pub income_period: String,
    pub income_day: i64,
    #[serde(default)]
    pub income_anchor: Option<String>,
}

impl Default for Settings {
    fn default() -> Self {
        // Weekly, Tuesday — this user's payday.
        Settings { income_period: "weekly".into(), income_day: 2, income_anchor: None }
    }
}

/// A user-defined category. `kind` is "income" | "expense" | "transfer".
/// `rollover` makes it a sinking fund whose unspent budget accrues across periods.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Category {
    pub id: i64,
    pub name: String,
    pub color: String,
    pub sort_order: i64,
    pub kind: String,
    pub rollover: bool,
    /// ISO date the envelope began accruing (defaults to when rollover was enabled).
    pub rollover_start: Option<String>,
}

/// A per-period budget allocation for a category. `effective_from` (ISO date) is
/// when the amount took effect; the current budget is the latest one <= today.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Budget {
    pub id: i64,
    pub category_id: i64,
    pub amount: f64,
    pub effective_from: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Account {
    pub id: String,
    pub name: String,
    pub connection: Option<String>,
    pub enabled: bool,
}

/// A stored transaction. `id` is Akahu's `_id` for bank rows, or a synthetic id
/// for manual/recurring ones. `source` = akahu|manual|recurring, `status` =
/// settled|pending. `edited` locks a row against being overwritten by sync.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Transaction {
    pub id: String,
    pub account_id: Option<String>,
    pub date: String,
    pub amount: f64,
    pub description: Option<String>,
    pub merchant_name: Option<String>,
    pub akahu_category: Option<String>,
    pub user_category_id: Option<i64>,
    pub source: String,
    pub status: String,
    pub edited: bool,
    /// True when the category was auto-applied by a learned map and the user
    /// hasn't confirmed it yet (shown with a "Suggested" badge + confirm/reject).
    pub suggested: bool,
    /// When false, the transaction is excluded from all dashboard budget maths
    /// (e.g. a reimbursement owed to you, or a payback carried across weeks).
    pub in_budget: bool,
}

/// A merchant→category mapping (or description-substring fallback) that
/// auto-categorises uncategorised transactions. `field` = merchant|description.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MerchantMap {
    pub id: i64,
    pub field: String,
    pub pattern: String,
    pub category_id: i64,
}

/// A recurring bill template that materialises transactions on its schedule.
/// `frequency` = weekly|fortnightly|monthly|annual.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecurringBill {
    pub id: i64,
    pub name: String,
    pub amount: f64,
    pub category_id: Option<i64>,
    pub frequency: String,
    pub anchor_date: String,
    pub active: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncState {
    pub last_sync_at: Option<String>,
    pub last_run_status: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SyncResult {
    pub inserted: usize,
    pub updated: usize,
    pub deleted: usize,
    pub pending: usize,
    pub total_transactions: i64,
    pub last_sync_at: String,
}

/// One dashboard row: a category's budget vs actual for the current period,
/// plus its rollover envelope balance (0 for non-rollover categories).
#[derive(Debug, Clone, Serialize)]
pub struct DashboardRow {
    pub category_id: Option<i64>,
    pub category_name: String,
    pub color: String,
    pub kind: String,
    pub rollover: bool,
    pub budget: f64,
    pub spent: f64,
    pub envelope_balance: f64,
}

/// The period dashboard. `surplus` = income − non-rollover expense spend −
/// rollover expense budget (positive = spare to move to savings).
#[derive(Debug, Clone, Serialize)]
pub struct DashboardSummary {
    pub period_start: String,
    pub period_end: String,
    pub income: f64,
    pub expense_spent: f64,
    pub rollover_budget: f64,
    pub surplus: f64,
    pub rows: Vec<DashboardRow>,
    pub uncategorized_count: i64,
}

/// A read-only snapshot of what Akahu currently holds, for troubleshooting
/// "where are today's transactions?" — distinguishes Akahu-side lag (data not
/// there yet) from an app bug (data there but not stored/displayed). No tokens.
#[derive(Debug, Clone, Serialize)]
pub struct AkahuDiagnostic {
    pub account_count: usize,
    /// When Akahu last refreshed transactions from the bank (max across accounts).
    pub refreshed_at: Option<String>,
    pub settled_count: usize,
    pub newest_settled_date: Option<String>,
    pub pending_count: usize,
    pub newest_pending_date: Option<String>,
    /// The most recent handful of transactions Akahu returns (settled + pending),
    /// dates already converted to local time — so you can eyeball today's data.
    pub recent: Vec<DiagTx>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DiagTx {
    pub date: String,
    pub amount: f64,
    pub description: Option<String>,
    pub merchant: Option<String>,
    pub status: String,
}

/// Whether each Akahu credential is present in the keychain (never the values).
#[derive(Debug, Clone, Serialize)]
pub struct CredentialStatus {
    pub app_token: bool,
    pub app_secret: bool,
    pub user_token: bool,
}
