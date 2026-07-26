use std::sync::Mutex;

use keyring::Entry;
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::models::CredentialStatus;

const SERVICE: &str = "com.richarddavies.spending-tracker";
// All three tokens live in ONE keychain item, so macOS prompts once, not per token.
const ACCOUNT: &str = "akahu_credentials";

#[derive(Default, Clone, Serialize, Deserialize)]
struct Stored {
    app_token: Option<String>,
    app_secret: Option<String>,
    user_token: Option<String>,
}

fn entry() -> AppResult<Entry> {
    Ok(Entry::new(SERVICE, ACCOUNT)?)
}

fn read_keychain() -> AppResult<Stored> {
    match entry()?.get_password() {
        Ok(json) => Ok(serde_json::from_str(&json).unwrap_or_default()),
        Err(keyring::Error::NoEntry) => Ok(Stored::default()),
        Err(e) => Err(AppError::Keyring(e)),
    }
}

fn write_keychain(s: &Stored) -> AppResult<()> {
    entry()?.set_password(&serde_json::to_string(s)?)?;
    Ok(())
}

/// Tauri-managed credential cache. Reads the Keychain at most once per launch
/// (one OS password prompt), then serves everything from memory.
pub struct Creds(Mutex<Cache>);

#[derive(Default)]
struct Cache {
    loaded: bool,
    data: Stored,
}

impl Creds {
    pub fn new() -> Self {
        Creds(Mutex::new(Cache::default()))
    }

    fn ensure_loaded(cache: &mut Cache) -> AppResult<()> {
        if !cache.loaded {
            cache.data = read_keychain()?;
            cache.loaded = true;
        }
        Ok(())
    }

    fn status_of(data: &Stored) -> CredentialStatus {
        CredentialStatus {
            app_token: data.app_token.is_some(),
            app_secret: data.app_secret.is_some(),
            user_token: data.user_token.is_some(),
        }
    }

    pub fn status(&self) -> AppResult<CredentialStatus> {
        let mut c = self.0.lock().unwrap();
        Self::ensure_loaded(&mut c)?;
        Ok(Self::status_of(&c.data))
    }

    /// App Token + User Token for API calls (App Secret isn't used for data pulls).
    pub fn api(&self) -> AppResult<(String, String)> {
        let mut c = self.0.lock().unwrap();
        Self::ensure_loaded(&mut c)?;
        let app = c
            .data
            .app_token
            .clone()
            .ok_or_else(|| AppError::msg("Akahu App Token not set — add it in Settings"))?;
        let user = c
            .data
            .user_token
            .clone()
            .ok_or_else(|| AppError::msg("Akahu User Token not set — add it in Settings"))?;
        Ok((app, user))
    }

    /// Save any provided (non-empty) tokens, keeping the others. Updates both the
    /// Keychain and the cache so subsequent calls need no further prompts.
    pub fn save(
        &self,
        app: Option<String>,
        secret: Option<String>,
        user: Option<String>,
    ) -> AppResult<CredentialStatus> {
        let mut c = self.0.lock().unwrap();
        Self::ensure_loaded(&mut c)?;
        let set_field = |field: &mut Option<String>, val: Option<String>| {
            if let Some(v) = val {
                let v = v.trim();
                if !v.is_empty() {
                    *field = Some(v.to_string());
                }
            }
        };
        set_field(&mut c.data.app_token, app);
        set_field(&mut c.data.app_secret, secret);
        set_field(&mut c.data.user_token, user);
        write_keychain(&c.data)?;
        Ok(Self::status_of(&c.data))
    }

    pub fn clear(&self) -> AppResult<CredentialStatus> {
        let mut c = self.0.lock().unwrap();
        match entry()?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(e) => return Err(AppError::Keyring(e)),
        }
        c.data = Stored::default();
        c.loaded = true;
        Ok(Self::status_of(&c.data))
    }
}
