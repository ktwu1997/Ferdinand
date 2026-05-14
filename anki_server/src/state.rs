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
//! ## Concurrency model
//!
//! The outer `users` map is protected by a `std::sync::Mutex` held only for
//! the instant needed to find-or-create a per-user `Arc<tokio::sync::Mutex<Option<AppState>>>`.
//! That per-user cell serialises concurrent first-use requests for the *same*
//! user — the first waiter builds the collection, stores it in the `Option`,
//! then releases the lock; all subsequent waiters see `Some(...)` and clone
//! cheaply.  Different users never contend on each other's lock, which
//! preserves parallel throughput during a multi-user cold start.
//!
//! This eliminates the TOCTOU race present in the old design where two
//! concurrent first-use requests for the same user could both pass the
//! `None` check, both call `CollectionBuilder::build`, and the SQLite WAL
//! exclusive-write lock would cause the loser to block indefinitely.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::Mutex as StdMutex;

use anki::collection::{Collection, CollectionBuilder};

/// Acquire a `std::sync::Mutex` lock, recovering from poison instead of
/// propagating a second panic. When a thread panics while holding the lock,
/// `std::sync::Mutex` marks itself *poisoned* and every subsequent `.lock()`
/// returns `Err(PoisonError)`. Calling `.unwrap()` or `.expect()` on that
/// error causes a second panic and tears down the whole process.
///
/// This helper extracts the inner guard from the poison error — the data is
/// still valid (the panicking thread's changes may be partially applied, but
/// for append-only or idempotent structures like our maps and SQLite
/// connections that's acceptable) — and logs a `tracing::error` so operators
/// see the event in logs without the process dying.
pub(crate) fn lock_or_recover<T>(m: &StdMutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| {
        tracing::error!("std::sync::Mutex poisoned — recovering inner state");
        e.into_inner()
    })
}
use anyhow::Context;
use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use axum::http::StatusCode;
use tokio::sync::Mutex;

use crate::auth::db::AuthDb;
use crate::auth::middleware::AuthedUser;
use crate::auth::rate_limit::LoginRateLimiter;
use crate::error::ServerError;

/// A per-user "build once" cell.  The outer `Option` starts as `None`; the
/// first task to hold the inner `Mutex` builds `AppState` and flips it to
/// `Some`.  Subsequent holders clone directly from the `Some` value.
type UserCell = Arc<Mutex<Option<AppState>>>;

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
    /// `username → per-user init cell`.  The outer `StdMutex` is held only
    /// for the instant needed to locate or create the [`UserCell`]; the
    /// actual (potentially slow) collection open happens under the inner
    /// `tokio::sync::Mutex`, so the outer lock is never held across I/O.
    users: Arc<StdMutex<HashMap<String, UserCell>>>,
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

    /// Expose the inner per-user cell for testing (concurrent-open assertion).
    #[cfg(test)]
    pub(crate) fn user_cell_for(&self, username: &str) -> Option<UserCell> {
        lock_or_recover(&self.users)
            .get(username)
            .cloned()
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
    /// **Thread-safety**: concurrent first-use calls for the *same* user
    /// serialise on the per-user [`UserCell`] mutex so `CollectionBuilder`
    /// is invoked exactly once.  Calls for *different* users proceed in
    /// parallel — they contend on the outer map lock only for the nanoseconds
    /// needed to insert/retrieve the cell, never during the actual I/O.
    pub async fn app_state_for(&self, username: &str) -> anyhow::Result<AppState> {
        // Step 1 — acquire (or create) this user's init cell.
        // Hold the outer StdMutex only for this map operation; drop it
        // before any async work.
        let cell: UserCell = {
            let mut map = lock_or_recover(&self.users);
            map.entry(username.to_string())
                .or_insert_with(|| Arc::new(Mutex::new(None)))
                .clone()
        };

        // Step 2 — serialise concurrent first-use on the per-user mutex.
        let mut guard = cell.lock().await;
        if let Some(existing) = guard.as_ref() {
            return Ok(existing.clone());
        }

        // Step 3 — we are the winner; build the collection.
        let users_dir = (*self.users_dir).clone();
        let user = username.to_string();
        let built =
            tokio::task::spawn_blocking(move || AppState::open_for_user(&users_dir, &user))
                .await
                .with_context(|| format!("spawn_blocking for user '{username}'"))??;

        *guard = Some(built.clone());
        Ok(built)
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
    pub fn open_for_user(users_dir: impl AsRef<Path>, username: &str) -> anyhow::Result<Self> {
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
                retry_after_secs: None,
            })?;
        state.app_state_for(user.username()).await.map_err(|err| {
            // The collection open is lazy (first request from each user
            // opens it). When it fails — typically the very first request
            // after the container wakes from idle-sleep, where the previous
            // process hasn't released the on-disk SQLite lock yet — surface
            // a *retryable* 503 + `Retry-After`, not a 500. A reload then
            // succeeds because the open path is fine on the second try; a
            // bare 500 would have the client treat it as permanent.
            tracing::warn!(
                user = %user.username(),
                error = ?err,
                "collection not ready — replying 503 Retry-After",
            );
            ServerError::service_unavailable(
                format!("collection not ready: {err}"),
                COLLECTION_OPEN_RETRY_AFTER_SECS,
            )
        })
    }
}

/// `Retry-After` (seconds) advertised when a collection open fails on the
/// cold path. One second: the contended on-disk lock clears almost
/// immediately once the previous process is fully gone, and a short value
/// keeps the user-visible "waking up" window tight.
const COLLECTION_OPEN_RETRY_AFTER_SECS: u64 = 1;

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

    /// A users-dir that is actually a regular file: `open_for_user` will
    /// fail at `create_dir_all(<file>/alice)`. Stands in for the cold-start
    /// "collection can't be opened yet" condition the 503 path exists for.
    fn broken_users_dir() -> PathBuf {
        let p = std::env::temp_dir().join(format!(
            "ferdinand_state_broken_{}_{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::write(&p, b"not a directory").unwrap();
        p
    }

    fn parts_with_user(username: &str) -> Parts {
        let mut req = axum::http::Request::builder().body(()).unwrap();
        req.extensions_mut()
            .insert(AuthedUser(username.to_string()));
        req.into_parts().0
    }

    #[tokio::test]
    async fn app_state_extractor_returns_503_with_retry_after_when_open_fails() {
        let server = ServerState::new(tmp_auth_db(), broken_users_dir());
        let mut parts = parts_with_user("alice");
        match AppState::from_request_parts(&mut parts, &server).await {
            Ok(_) => panic!("a broken users-dir must fail the collection open"),
            Err(err) => {
                assert_eq!(
                    err.status,
                    StatusCode::SERVICE_UNAVAILABLE,
                    "a cold-start collection-open failure must be a retryable 503, not a 500",
                );
                assert_eq!(
                    err.retry_after_secs,
                    Some(COLLECTION_OPEN_RETRY_AFTER_SECS),
                    "503 must advertise Retry-After so clients retry instead of \
                     showing a hard error",
                );
            }
        }
    }

    #[tokio::test]
    async fn app_state_extractor_succeeds_on_a_healthy_users_dir() {
        // Counterpart to the 503 test: a normal users-dir resolves cleanly,
        // so the extractor is not blanket-503-ing every request.
        let server = ServerState::new(tmp_auth_db(), tmp_users_dir());
        let mut parts = parts_with_user("alice");
        if AppState::from_request_parts(&mut parts, &server)
            .await
            .is_err()
        {
            panic!("a healthy users-dir must resolve an AppState");
        }
    }
}
