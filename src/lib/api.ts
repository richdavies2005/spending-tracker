// Single entry point for all backend calls. In the Tauri app this forwards to
// Rust via `invoke`; in a plain browser (npm run dev) it uses the localStorage
// mock so the UI can be developed and verified without the native shell.
// Tauri maps camelCase JS keys to the snake_case Rust params, so args are camelCase.
import { invoke } from "@tauri-apps/api/core";
import { mockInvoke } from "./mock";
import type {
  Account,
  AkahuDiagnostic,
  Budget,
  Category,
  CategoryKind,
  CredentialStatus,
  DashboardSummary,
  IncomePeriod,
  MerchantMap,
  RecurringBill,
  BillFrequency,
  Settings,
  SyncResult,
  SyncState,
  Transaction,
} from "./types";

export const IS_TAURI =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return IS_TAURI ? invoke<T>(cmd, args) : (mockInvoke(cmd, args ?? {}) as Promise<T>);
}

export const api = {
  // Settings
  getSettings: () => call<Settings>("get_settings"),
  setSettings: (
    incomePeriod: IncomePeriod,
    incomeDay: number,
    incomeAnchor: string | null,
  ) => call<void>("set_settings", { incomePeriod, incomeDay, incomeAnchor }),

  // Categories
  categoriesList: () => call<Category[]>("categories_list"),
  categoryCreate: (name: string, color: string, kind: CategoryKind, rollover: boolean) =>
    call<Category>("category_create", { name, color, kind, rollover }),
  categoryUpdate: (
    id: number,
    name: string,
    color: string,
    sortOrder: number,
    kind: CategoryKind,
    rollover: boolean,
  ) => call<void>("category_update", { id, name, color, sortOrder, kind, rollover }),
  categoryDelete: (id: number) => call<void>("category_delete", { id }),

  // Budgets
  budgetsList: () => call<Budget[]>("budgets_list"),
  budgetSet: (categoryId: number, amount: number, effectiveFrom: string) =>
    call<void>("budget_set", { categoryId, amount, effectiveFrom }),
  budgetDelete: (id: number) => call<void>("budget_delete", { id }),

  // Accounts
  accountsList: () => call<Account[]>("accounts_list"),
  accountSetEnabled: (id: string, enabled: boolean) =>
    call<void>("account_set_enabled", { id, enabled }),

  // Merchant map
  mapList: () => call<MerchantMap[]>("map_list"),
  mapDelete: (id: number) => call<void>("map_delete", { id }),

  // Recurring bills
  billsList: () => call<RecurringBill[]>("bills_list"),
  billCreate: (
    name: string,
    amount: number,
    categoryId: number | null,
    frequency: BillFrequency,
    anchorDate: string,
  ) => call<number>("bill_create", { name, amount, categoryId, frequency, anchorDate }),
  billUpdate: (
    id: number,
    name: string,
    amount: number,
    categoryId: number | null,
    frequency: BillFrequency,
    anchorDate: string,
    active: boolean,
  ) => call<void>("bill_update", { id, name, amount, categoryId, frequency, anchorDate, active }),
  billDelete: (id: number) => call<void>("bill_delete", { id }),

  // Transactions
  transactionsList: (showTransfers: boolean, allPeriods: boolean) =>
    call<Transaction[]>("transactions_list", { showTransfers, allPeriods }),
  transactionSetCategory: (id: string, categoryId: number | null, learn: boolean) =>
    call<number>("transaction_set_category", { id, categoryId, learn }),
  transactionConfirm: (id: string) => call<void>("transaction_confirm", { id }),
  transactionReject: (id: string) => call<void>("transaction_reject", { id }),
  transactionSetInBudget: (id: string, inBudget: boolean) =>
    call<void>("transaction_set_in_budget", { id, inBudget }),
  transactionEdit: (
    id: string,
    date: string,
    amount: number,
    description: string | null,
    merchantName: string | null,
    categoryId: number | null,
  ) => call<void>("transaction_edit", { id, date, amount, description, merchantName, categoryId }),
  transactionReset: (id: string) => call<void>("transaction_reset", { id }),
  transactionDelete: (id: string) => call<void>("transaction_delete", { id }),
  transactionsTrimCount: (keepDays: number) =>
    call<number>("transactions_trim_count", { keepDays }),
  transactionsTrim: (keepDays: number) => call<number>("transactions_trim", { keepDays }),
  manualAdd: (
    date: string,
    amount: number,
    description: string | null,
    merchantName: string | null,
    categoryId: number | null,
  ) => call<Transaction>("manual_add", { date, amount, description, merchantName, categoryId }),

  // Dashboard
  dashboard: () => call<DashboardSummary>("dashboard"),

  // Sync
  syncStateGet: () => call<SyncState>("sync_state_get"),
  syncNow: () => call<SyncResult>("sync_now"),
  syncFromBank: () => call<SyncResult>("sync_from_bank"),
  syncFull: () => call<SyncResult>("sync_full"),
  akahuDiagnostic: () => call<AkahuDiagnostic>("akahu_diagnostic"),

  // Credentials / Akahu
  credentialsStatus: () => call<CredentialStatus>("credentials_status"),
  saveCredentials: (appToken: string, appSecret: string, userToken: string) =>
    call<CredentialStatus>("save_credentials", { appToken, appSecret, userToken }),
  clearCredentials: () => call<CredentialStatus>("clear_credentials"),
  akahuValidate: () => call<string>("akahu_validate"),
};
