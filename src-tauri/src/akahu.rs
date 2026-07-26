use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION};
use serde_json::Value;

use crate::error::{AppError, AppResult};

const BASE: &str = "https://api.akahu.io/v1";

/// Minimal Akahu API client for a personal app. Auth is two headers:
///   X-Akahu-Id: <app token>   and   Authorization: Bearer <user token>
pub struct AkahuClient {
    http: reqwest::Client,
    app_token: String,
    user_token: String,
}

/// A bank account as returned by GET /accounts (only the fields we store).
pub struct AkahuAccount {
    pub id: String,
    pub name: String,
    pub connection: Option<String>,
    /// ISO timestamp Akahu last refreshed this account's transactions from the
    /// bank. Advances after a successful POST /refresh — used to detect landing.
    pub refreshed_at: Option<String>,
}

impl AkahuClient {
    pub fn new(app_token: String, user_token: String) -> Self {
        AkahuClient {
            http: reqwest::Client::new(),
            app_token,
            user_token,
        }
    }

    fn headers(&self) -> AppResult<HeaderMap> {
        let mut h = HeaderMap::new();
        h.insert(
            "X-Akahu-Id",
            HeaderValue::from_str(&self.app_token)
                .map_err(|_| AppError::msg("App Token contains invalid characters"))?,
        );
        h.insert(
            AUTHORIZATION,
            HeaderValue::from_str(&format!("Bearer {}", self.user_token))
                .map_err(|_| AppError::msg("User Token contains invalid characters"))?,
        );
        Ok(h)
    }

    /// GET a path with optional query params, returning the parsed JSON envelope.
    /// Turns Akahu's `{ success: false, message }` bodies into readable errors.
    async fn get(&self, path: &str, query: &[(&str, &str)]) -> AppResult<Value> {
        let resp = self
            .http
            .get(format!("{BASE}{path}"))
            .headers(self.headers()?)
            .query(query)
            .send()
            .await?;

        let status = resp.status();
        let body: Value = resp.json().await.map_err(|_| {
            AppError::msg(format!("Akahu returned a non-JSON response (HTTP {status})"))
        })?;

        if body.get("success").and_then(Value::as_bool) == Some(false) || !status.is_success() {
            let msg = body
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("request failed");
            return Err(AppError::msg(format!("Akahu error (HTTP {status}): {msg}")));
        }
        Ok(body)
    }

    /// POST a path with no body, returning the parsed JSON envelope (same error
    /// handling as `get`).
    async fn post(&self, path: &str) -> AppResult<Value> {
        let resp = self
            .http
            .post(format!("{BASE}{path}"))
            .headers(self.headers()?)
            .send()
            .await?;

        let status = resp.status();
        let body: Value = resp.json().await.map_err(|_| {
            AppError::msg(format!("Akahu returned a non-JSON response (HTTP {status})"))
        })?;

        if body.get("success").and_then(Value::as_bool) == Some(false) || !status.is_success() {
            let msg = body
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("request failed");
            return Err(AppError::msg(format!("Akahu error (HTTP {status}): {msg}")));
        }
        Ok(body)
    }

    /// POST /refresh — ask Akahu to re-poll the bank for all connected accounts
    /// now, rather than waiting for its scheduled sync. Asynchronous: the fresh
    /// data lands a little later (see the polling in `sync`).
    pub async fn refresh(&self) -> AppResult<()> {
        self.post("/refresh").await?;
        Ok(())
    }

    /// GET /me — validates credentials and returns a display name if present.
    pub async fn me(&self) -> AppResult<String> {
        let body = self.get("/me", &[]).await?;
        let item = body.get("item").cloned().unwrap_or(Value::Null);
        let name = item
            .get("preferred_name")
            .or_else(|| item.get("first_name"))
            .or_else(|| item.get("email"))
            .and_then(Value::as_str)
            .unwrap_or("your Akahu account")
            .to_string();
        Ok(name)
    }

    /// GET /accounts — the accounts the user has connected.
    pub async fn accounts(&self) -> AppResult<Vec<AkahuAccount>> {
        let body = self.get("/accounts", &[]).await?;
        let items = body.get("items").and_then(Value::as_array).cloned().unwrap_or_default();
        let accounts = items
            .into_iter()
            .filter_map(|a| {
                let id = a.get("_id").and_then(Value::as_str)?.to_string();
                let name = a
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or("Account")
                    .to_string();
                let connection = a
                    .get("connection")
                    .and_then(|c| c.get("name"))
                    .and_then(Value::as_str)
                    .map(str::to_string);
                let refreshed_at = a
                    .get("refreshed")
                    .and_then(|r| r.get("transactions"))
                    .and_then(Value::as_str)
                    .map(str::to_string);
                Some(AkahuAccount { id, name, connection, refreshed_at })
            })
            .collect();
        Ok(accounts)
    }

    /// GET /transactions from `start` (exclusive, ISO-8601) to now, following the
    /// cursor until all pages are collected. Returns the raw transaction objects.
    pub async fn transactions_since(&self, start: &str) -> AppResult<Vec<Value>> {
        let mut all = Vec::new();
        let mut cursor: Option<String> = None;

        loop {
            let mut query: Vec<(&str, &str)> = vec![("start", start)];
            if let Some(c) = cursor.as_deref() {
                query.push(("cursor", c));
            }
            let body = self.get("/transactions", &query).await?;

            if let Some(items) = body.get("items").and_then(Value::as_array) {
                all.extend(items.iter().cloned());
            }

            cursor = next_cursor(&body);
            if cursor.is_none() {
                break;
            }
        }
        Ok(all)
    }

    /// GET /transactions/pending — pending (not-yet-settled) transactions across
    /// the user's connected accounts, following the cursor so none are missed.
    pub async fn transactions_pending(&self) -> AppResult<Vec<Value>> {
        let mut all = Vec::new();
        let mut cursor: Option<String> = None;
        loop {
            let mut query: Vec<(&str, &str)> = vec![];
            if let Some(c) = cursor.as_deref() {
                query.push(("cursor", c));
            }
            let body = self.get("/transactions/pending", &query).await?;
            if let Some(items) = body.get("items").and_then(Value::as_array) {
                all.extend(items.iter().cloned());
            }
            cursor = next_cursor(&body);
            if cursor.is_none() {
                break;
            }
        }
        Ok(all)
    }
}

/// Extract a non-empty `cursor.next` from a response envelope (empty string = done).
fn next_cursor(body: &Value) -> Option<String> {
    body.get("cursor")
        .and_then(|c| c.get("next"))
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}
