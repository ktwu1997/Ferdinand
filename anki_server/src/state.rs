//! Per-user state plumbing.
//!
//! Phase A1 opened ONE collection at process start and stuffed it into a
//! global `AppState`. Phase A2 splits that into two layers:
//!
//! * [`ServerState`] — the **router** state. Holds the auth handle, the
//!   `users-dir` path, and a cache of already-opened per-user [`AppState`]s.
//!   This is what `Router::with_state(...)` receives and what extractors
//!   like `State<ServerState>` give you (used by the auth routes).
//!
//! * [`AppState`] — the **per-request** state. Wraps a single user's
//!   `Collection`. Implements `FromRequestParts<ServerState>` so existing
//!   handlers can simply ask for `state: AppState` and get the collection
//!   for whichever user the session resolved to. The first request from a
//!   given user opens their collection; subsequent requests reuse it.
//!
//! The `users` cache uses `std::sync::Mutex` (not tokio's) because the
//! lookup is non-blocking. `Collection::open` itself does sync I/O, but
//! it's gated by tokio's `spawn_blocking` so we don't stall the runtime.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::Mutex as StdMutex;

use anki::collection::{Collection, CollectionBuilder};
use anyhow::Context;
use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use axum::http::StatusCode;
use tokio::sync::Mutex;

use crate::auth::db::AuthDb;
use crate::auth::middleware::AuthedUser;
use crate::auth::rate_limit::LoginRateLimiter;
use crate::error::ServerError;

/// Router-wide state. Cheaply clonable.
#[derive(Clone)]
pub struct ServerState {
    pub auth: AuthDb,
    pub users_dir: Arc<PathBuf>,
    /// In-memory rate limiter for `/api/auth/login`. Shared across requests
    /// so a single attacker can't dodge it by fanning out connections.
    pub login_limiter: Arc<LoginRateLimiter>,
    /// Phase B2: the username with admin privileges, sourced from
    /// `ANKI_ADMIN_USERNAME` at boot. `None` = no admin user is configured,
    /// which makes every `/api/admin/*` route 403. Wrapped in `Arc<String>`
    /// rather than `String` so the per-request clone is a refcount bump
    /// instead of a heap copy — admin checks are on the hot path of every
    /// admin-router request.
    pub admin_username: Option<Arc<String>>,
    /// `username → AppState`. Inserted lazily on first use so a fresh user
    /// doesn't pay a cold-start penalty until they actually authenticate.
    users: Arc<StdMutex<HashMap<String, AppState>>>,
}

impl ServerState {
    pub fn new(auth: AuthDb, users_dir: impl Into<PathBuf>) -> Self {
        Self {
            auth,
            users_dir: Arc::new(users_dir.into()),
            login_limiter: Arc::new(LoginRateLimiter::new()),
            admin_username: None,
            users: Arc::new(StdMutex::new(HashMap::new())),
        }
    }

    /// Phase B2: builder-style setter so `main.rs` can wire the admin
    /// username read from `ANKI_ADMIN_USERNAME` without overloading
    /// `new()` for what's still an optional slot. Empty / whitespace-only
    /// strings collapse to `None` — operators flipping the env var on
    /// for an experiment shouldn't accidentally end up with an admin
    /// account named " ".
    pub fn with_admin_username(mut self, raw: Option<String>) -> Self {
        self.admin_username = raw
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .map(Arc::new);
        self
    }

    /// Phase B2 helper used by the admin gate + `/api/auth/me`. Cheap —
    /// just compares the configured admin username against the supplied
    /// candidate. Returns `false` if no admin is configured.
    pub fn is_admin(&self, username: &str) -> bool {
        self.admin_username
            .as_ref()
            .map(|a| a.as_str() == username)
            .unwrap_or(false)
    }

    /// Resolve (or open + cache) the [`AppState`] for `username`.
    ///
    /// Cheap once warmed: a `HashMap` lookup. Cold path opens the
    /// collection (which is I/O-heavy, hence `spawn_blocking`) before the
    /// cache fills.
    pub async fn app_state_for(&self, username: &str) -> anyhow::Result<AppState> {
        if let Some(existing) = self.cached(username) {
            return Ok(existing);
        }
        // Open outside the cache lock — the open is slow and we don't want
        // to serialise concurrent first-uses for *different* users.
        let users_dir = (*self.users_dir).clone();
        let user = username.to_string();
        let opened = tokio::task::spawn_blocking(move || AppState::open_for_user(&users_dir, &user))
            .await
            .with_context(|| format!("spawn_blocking for user '{username}'"))??;
        // Re-check under the lock; another concurrent first-use might have
        // beaten us. If so, drop ours on the floor — but the on-disk
        // collection has already been opened twice. CollectionBuilder
        // tolerates that (it acquires its own file lock).
        let mut cache = self.users.lock().expect("user cache poisoned");
        Ok(cache
            .entry(username.to_string())
            .or_insert(opened)
            .clone())
    }

    fn cached(&self, username: &str) -> Option<AppState> {
        self.users
            .lock()
            .expect("user cache poisoned")
            .get(username)
            .cloned()
    }
}

/// Per-user collection handle. One per logged-in user, kept alive for the
/// server's lifetime.
#[derive(Clone)]
pub struct AppState {
    pub col: Arc<Mutex<Collection>>,
    /// Canonicalised media directory (`<users_dir>/<username>/collection.media/`).
    /// Sibling of the .anki2 file inside the user's data directory.
    /// Used by `routes::media` to serve asset bytes.
    pub media_dir: Arc<PathBuf>,
}

impl AppState {
    /// Open the collection living under `<users_dir>/<username>/`.
    /// Creates the user dir and media sibling on first run so a fresh
    /// user works without manual setup. Also runs the Phase-A1 startup
    /// hooks (`bootstrap` + `seed_notetypes`) so a fresh user gets the
    /// same opinionated layout as ktwu's fork — both are idempotent so
    /// repeated opens are no-ops.
    pub fn open_for_user(
        users_dir: impl AsRef<Path>,
        username: &str,
    ) -> anyhow::Result<Self> {
        let user_dir = users_dir.as_ref().join(username);
        std::fs::create_dir_all(&user_dir)
            .with_context(|| format!("create user dir {}", user_dir.display()))?;
        let col_path = user_dir.join("collection.anki2");
        // Phase B3a: wire up the desktop-style media paths
        // (`<col_path>.media/` + `<col_path>.mdb`) so rslib's media
        // manager has somewhere to store imported attachments. Without
        // these set, `Collection::import_apkg` fails with
        // `InvalidInput("attempted media operation without media folder
        // set")` even when the .apkg has no media. The .media dir
        // resolved here matches the canonical sibling that
        // `ensure_media_dir` produces below — they're the same path,
        // so this isn't a divergence.
        let mut col = CollectionBuilder::new(&col_path)
            .with_desktop_media_paths()
            .build()
            .with_context(|| format!("open collection at {}", col_path.display()))?;
        crate::bootstrap::seed_if_requested(&mut col)?;
        crate::seed_notetypes::seed_if_missing(&mut col)?;
        let media_dir = ensure_media_dir(&user_dir)?;
        Ok(Self {
            col: Arc::new(Mutex::new(col)),
            media_dir: Arc::new(media_dir),
        })
    }
}

/// Make `AppState` itself an extractor. Handlers that previously took
/// `State<AppState>` switch to taking `AppState`; the resolution flow is:
///
/// 1. `require_auth` middleware put an [`AuthedUser`] into request
///    extensions if the session was valid.
/// 2. We pull that out, look up the per-user `AppState` in the cache,
///    open + cache on first use.
///
/// 401-mapped if there's no AuthedUser — but in normal operation that
/// shouldn't happen because `require_auth` would have already short-
/// circuited the request. The check is here to make it impossible to
/// accidentally mount a non-public route outside the auth layer and
/// silently leak a default user's collection.
impl FromRequestParts<ServerState> for AppState {
    type Rejection = ServerError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &ServerState,
    ) -> Result<Self, Self::Rejection> {
        let user = parts
            .extensions
            .get::<AuthedUser>()
            .cloned()
            .ok_or_else(|| ServerError {
                source: anyhow::anyhow!("AppState requested without AuthedUser in extensions"),
                status: StatusCode::UNAUTHORIZED,
            })?;
        Ok(state.app_state_for(user.username()).await?)
    }
}

fn ensure_media_dir(user_dir: &Path) -> anyhow::Result<PathBuf> {
    // Anki convention: collection.anki2 → collection.media/ as siblings.
    let media = user_dir.join("collection.media");
    std::fs::create_dir_all(&media)
        .with_context(|| format!("create media dir {}", media.display()))?;
    std::fs::canonicalize(&media)
        .with_context(|| format!("canonicalise media dir {}", media.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_users_dir() -> PathBuf {
        let p = std::env::temp_dir().join(format!(
            "ferdinand_state_test_{}_{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    fn tmp_auth_db() -> AuthDb {
        let path = std::env::temp_dir().join(format!(
            "ferdinand_state_authdb_{}_{}.db",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        AuthDb::open(&path).unwrap()
    }

    #[tokio::test]
    async fn cache_returns_same_handle_on_second_lookup() {
        let server = ServerState::new(tmp_auth_db(), tmp_users_dir());
        let a = server.app_state_for("alice").await.unwrap();
        let b = server.app_state_for("alice").await.unwrap();
        // Same Arc pointer = cache hit, not a re-open.
        assert!(
            Arc::ptr_eq(&a.col, &b.col),
            "second lookup should return the cached AppState"
        );
    }

    #[tokio::test]
    async fn distinct_users_get_distinct_app_states() {
        let server = ServerState::new(tmp_auth_db(), tmp_users_dir());
        let a = server.app_state_for("alice").await.unwrap();
        let b = server.app_state_for("bob").await.unwrap();
        assert!(
            !Arc::ptr_eq(&a.col, &b.col),
            "different users must not share a Collection"
        );
    }
}
