use serde::{Serialize, Serializer};

/// Unified error type for all commands. Serializes to a plain string so the
/// frontend receives a readable message from a rejected `invoke`.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("database error: {0}")]
    Db(#[from] rusqlite::Error),

    #[error("network error: {0}")]
    Http(#[from] reqwest::Error),

    #[error("keychain error: {0}")]
    Keyring(#[from] keyring::Error),

    #[error("data error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("{0}")]
    Msg(String),
}

impl AppError {
    pub fn msg(s: impl Into<String>) -> Self {
        AppError::Msg(s.into())
    }
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
