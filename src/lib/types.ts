// Mirrors the Rust structs in src-tauri/src/models.rs

export type CategoryKind = "income" | "expense" | "transfer";
export type TxSource = "akahu" | "manual" | "recurring";
export type TxStatus = "settled" | "pending";
export type BillFrequency = "weekly" | "fortnightly" | "monthly" | "annual";

export type IncomePeriod = "weekly" | "fortnightly" | "monthly";

export interface Settings {
  income_period: IncomePeriod;
  income_day: number; // weekly/fortnightly: 1=Mon..7=Sun; monthly: 1..31
  income_anchor: string | null; // YYYY-MM-DD reference payday, used by fortnightly
}

export interface Category {
  id: number;
  name: string;
  color: string;
  sort_order: number;
  kind: CategoryKind;
  rollover: boolean;
  rollover_start: string | null;
}

export interface Budget {
  id: number;
  category_id: number;
  amount: number;
  effective_from: string; // YYYY-MM-DD
}

export interface Account {
  id: string;
  name: string;
  connection: string | null;
  enabled: boolean;
}

export interface Transaction {
  id: string;
  account_id: string | null;
  date: string; // ISO-8601
  amount: number; // negative = spend, positive = income/refund
  description: string | null;
  merchant_name: string | null;
  akahu_category: string | null;
  user_category_id: number | null;
  source: TxSource;
  status: TxStatus;
  edited: boolean;
  suggested: boolean;
  in_budget: boolean;
}

export interface MerchantMap {
  id: number;
  field: "merchant" | "description" | "desckey";
  pattern: string;
  category_id: number;
}

export interface RecurringBill {
  id: number;
  name: string;
  amount: number;
  category_id: number | null;
  frequency: BillFrequency;
  anchor_date: string; // YYYY-MM-DD
  active: boolean;
}

export interface SyncState {
  last_sync_at: string | null;
  last_run_status: string | null;
}

export interface SyncResult {
  inserted: number;
  updated: number;
  deleted: number;
  pending: number;
  total_transactions: number;
  last_sync_at: string;
}

export interface DashboardRow {
  category_id: number | null;
  category_name: string;
  color: string;
  kind: CategoryKind;
  rollover: boolean;
  budget: number;
  spent: number;
  envelope_balance: number;
}

export interface DashboardSummary {
  period_start: string;
  period_end: string;
  income: number;
  expense_spent: number;
  rollover_budget: number;
  surplus: number;
  rows: DashboardRow[];
  uncategorized_count: number;
}

export interface CredentialStatus {
  app_token: boolean;
  app_secret: boolean;
  user_token: boolean;
}

export interface UpdateInfo {
  current: string;
  latest: string;
  available: boolean;
  url: string;
}

export interface DiagTx {
  date: string; // ISO-8601, local time
  amount: number;
  description: string | null;
  merchant: string | null;
  status: TxStatus;
}

export interface AkahuDiagnostic {
  account_count: number;
  refreshed_at: string | null;
  settled_count: number;
  newest_settled_date: string | null;
  pending_count: number;
  newest_pending_date: string | null;
  recent: DiagTx[];
}
