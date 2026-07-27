mod akahu;
mod commands;
mod db;
mod error;
mod models;
mod period;
mod secrets;
mod sync;

use tauri::Manager;

use db::Db;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // SQLite lives in the OS app-data directory: survives relaunch, and
            // lives outside the project tree.
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let db_path = dir.join("spending.sqlite3");
            let database = Db::open(&db_path).map_err(|e| format!("failed to open database: {e}"))?;

            // Bring any recurring bills up to date on launch.
            let _ = sync::materialize_due(&database);

            app.manage(database);
            app.manage(secrets::Creds::new());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_settings,
            commands::set_settings,
            commands::categories_list,
            commands::category_create,
            commands::category_update,
            commands::category_delete,
            commands::budgets_list,
            commands::budget_set,
            commands::budget_delete,
            commands::accounts_list,
            commands::account_set_enabled,
            commands::map_list,
            commands::map_delete,
            commands::bills_list,
            commands::bill_create,
            commands::bill_update,
            commands::bill_delete,
            commands::transactions_list,
            commands::transaction_set_category,
            commands::transaction_confirm,
            commands::transaction_reject,
            commands::transaction_set_in_budget,
            commands::transaction_edit,
            commands::transaction_reset,
            commands::transaction_delete,
            commands::transactions_trim_count,
            commands::transactions_trim,
            commands::manual_add,
            commands::dashboard,
            commands::sync_state_get,
            commands::sync_now,
            commands::sync_from_bank,
            commands::sync_full,
            commands::akahu_diagnostic,
            commands::check_for_update,
            commands::credentials_status,
            commands::save_credentials,
            commands::clear_credentials,
            commands::akahu_validate,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
