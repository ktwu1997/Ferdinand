//! Sqlite-backed users table for Phase A2 auth.
//!
//! One file (`<auth_db>` — default `data/auth.db`) holds two tables:
//!
//!   1. `users` — id / username / password_hash / created_at
//!   2. `sessions` — see [`super::session_store`] (created in the same
//!      schema bootstrap so we only open the connection once).
//!
//! The connection is wrapped in a `std::sync::Mutex` rather than a tokio
//! `Mutex` because rusqlite is sync-only. We never hold the mutex across an
//! `.await`, so this stays lock-free under load.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::Mutex;

use anyhow::Context;
use rusqlite::{params, Connection, OptionalExtension};

/// Handle to the auth database. Cheaply clonable (`Arc`-shared connection).
#[derive(Clone)]
pub struct AuthDb {
    inner: Arc<Mutex<Connection>>,
    /// Resolved on-disk path. Kept around so the integration test (and
    /// future admin tooling) can re-open the same file. `dead_code`
    /// allowed because production-mode `main.rs` only logs the original
    /// `String` form, but tests + admin tooling will need it.
    #[allow(dead_code)]
    pub path: Arc<PathBuf>,
}

/// Row read out of the `users` table. `id` and `created_at` are mirrored
/// straight from the schema so callers that need them later (admin
/// endpoints, migration tools) can do so without an extra query — silenced
/// `dead_code` until those land.
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct UserRow {
    pub id: i64,
    pub username: String,
    pub password_hash: String,
    pub created_at: i64,
}

impl AuthDb {
    /// Open (or create) the auth database at `path`. Creates the parent
    /// directory if missing so a fresh `data/` checkout boots without manual
    /// setup.
    pub fn open(path: impl AsRef<Path>) -> anyhow::Result<Self> {
        let path = path.as_ref().to_path_buf();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .with_context(|| format!("create auth-db parent {}", parent.display()))?;
        }
        let conn = Connection::open(&path)
            .with_context(|| format!("open auth db at {}", path.display()))?;
        // Defensive PRAGMAs: WAL keeps reads concurrent with the session
        // store's writes; foreign_keys=ON in case future migrations add FKs.
        conn.pragma_update(None, "journal_mode", "WAL").ok();
        conn.pragma_update(None, "foreign_keys", "ON").ok();
        let db = Self {
            inner: Arc::new(Mutex::new(conn)),
            path: Arc::new(path),
        };
        db.bootstrap_schema()?;
        Ok(db)
    }

    fn bootstrap_schema(&self) -> anyhow::Result<()> {
        let conn = self.inner.lock().expect("auth db poisoned");
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS users (
                 id            INTEGER PRIMARY KEY AUTOINCREMENT,
                 username      TEXT NOT NULL UNIQUE,
                 password_hash TEXT NOT NULL,
                 created_at    INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS sessions (
                 id          BLOB PRIMARY KEY,
                 data        BLOB NOT NULL,
                 expiry_date INTEGER NOT NULL
             );
             CREATE INDEX IF NOT EXISTS idx_sessions_expiry
                 ON sessions(expiry_date);",
        )?;
        Ok(())
    }

    /// Look a user up by username. Returns `None` if not found.
    pub fn find_user(&self, username: &str) -> anyhow::Result<Option<UserRow>> {
        let conn = self.inner.lock().expect("auth db poisoned");
        let row = conn
            .query_row(
                "SELECT id, username, password_hash, created_at
                   FROM users WHERE username = ?1",
                params![username],
                |row| {
                    Ok(UserRow {
                        id: row.get(0)?,
                        username: row.get(1)?,
                        password_hash: row.get(2)?,
                        created_at: row.get(3)?,
                    })
                },
            )
            .optional()?;
        Ok(row)
    }

    /// Insert a new user. Returns the assigned id.
    /// `Err` on UNIQUE conflict — caller maps that to a 409.
    pub fn insert_user(&self, username: &str, password_hash: &str) -> anyhow::Result<i64> {
        let now = unix_now();
        let conn = self.inner.lock().expect("auth db poisoned");
        conn.execute(
            "INSERT INTO users (username, password_hash, created_at)
             VALUES (?1, ?2, ?3)",
            params![username, password_hash, now],
        )
        .with_context(|| format!("insert user '{username}'"))?;
        Ok(conn.last_insert_rowid())
    }

    /// Borrow the underlying connection. Used by the session store, which
    /// shares this same db file. Held only for sync ops; never across await.
    pub(super) fn conn(&self) -> Arc<Mutex<Connection>> {
        Arc::clone(&self.inner)
    }
}

fn unix_now() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_db() -> AuthDb {
        // Per-test path so parallel `cargo test` runs don't collide.
        let path = std::env::temp_dir().join(format!(
            "ferdinand_authdb_test_{}_{}.db",
            std::process::id(),
            // Cheap unique-ish suffix from a monotonic-ish source.
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        AuthDb::open(&path).expect("open temp auth db")
    }

    #[test]
    fn schema_idempotent() {
        let db = tmp_db();
        // Re-open same path; should not panic / error.
        let _again = AuthDb::open(db.path.as_ref()).expect("reopen");
    }

    #[test]
    fn insert_then_find() {
        let db = tmp_db();
        let id = db.insert_user("ktwu", "phc-placeholder").unwrap();
        assert!(id > 0);
        let row = db.find_user("ktwu").unwrap().expect("user present");
        assert_eq!(row.username, "ktwu");
        assert_eq!(row.password_hash, "phc-placeholder");
    }

    #[test]
    fn find_returns_none_for_missing_user() {
        let db = tmp_db();
        assert!(db.find_user("nobody").unwrap().is_none());
    }

    #[test]
    fn duplicate_username_errors() {
        let db = tmp_db();
        db.insert_user("ktwu", "h1").unwrap();
        let err = db.insert_user("ktwu", "h2");
        assert!(err.is_err(), "second insert with same username must fail");
    }
}
