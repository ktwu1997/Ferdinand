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

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::Mutex;

use anyhow::Context;
use rusqlite::{params, Connection, OptionalExtension};

use crate::state::lock_or_recover;

use super::SESSION_USER_KEY;

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
/// `dead_code` until those land. Phase B2 surfaces `disabled_at` so login
/// can reject suspended accounts and the admin user list can render their
/// state.
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct UserRow {
    pub id: i64,
    pub username: String,
    pub password_hash: String,
    pub created_at: i64,
    /// Unix-seconds the admin disabled this account. `None` means active.
    /// Login rejects accounts where this is `Some(_)` regardless of the
    /// password verification result so a disabled user can't even probe
    /// whether they're disabled vs. wrong-password.
    pub disabled_at: Option<i64>,
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
        let conn = lock_or_recover(&self.inner);
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
        // Phase B2 migration: add `users.disabled_at` if it isn't there yet.
        // Fresh dbs already get the column via the CREATE-IF-NOT-EXISTS
        // (well, no — CREATE-IF-NOT-EXISTS only fires when the table is
        // absent); existing dbs need an idempotent ADD COLUMN. Guarding
        // with pragma_table_info means a re-run on a v2 db is a no-op
        // rather than an error.
        let has_disabled_at: bool = conn
            .query_row(
                "SELECT 1 FROM pragma_table_info('users') WHERE name = 'disabled_at'",
                [],
                |_| Ok(true),
            )
            .optional()?
            .unwrap_or(false);
        if !has_disabled_at {
            conn.execute("ALTER TABLE users ADD COLUMN disabled_at INTEGER", [])
                .context("add users.disabled_at column")?;
        }
        Ok(())
    }

    /// Look a user up by username. Returns `None` if not found.
    pub fn find_user(&self, username: &str) -> anyhow::Result<Option<UserRow>> {
        let conn = lock_or_recover(&self.inner);
        let row = conn
            .query_row(
                "SELECT id, username, password_hash, created_at, disabled_at
                   FROM users WHERE username = ?1",
                params![username],
                |row| {
                    Ok(UserRow {
                        id: row.get(0)?,
                        username: row.get(1)?,
                        password_hash: row.get(2)?,
                        created_at: row.get(3)?,
                        disabled_at: row.get(4)?,
                    })
                },
            )
            .optional()?;
        Ok(row)
    }

    /// Phase B2: enumerate every user. Used by the admin user-list
    /// endpoint. Sorted by `id` ascending so the seed user (`ktwu` on
    /// most installs) lands first and the result order is stable across
    /// calls — keeps the e2e suite's "list contains both" check
    /// order-insensitive without us paying for an extra `ORDER BY
    /// username`.
    pub fn list_users(&self) -> anyhow::Result<Vec<UserRow>> {
        let conn = lock_or_recover(&self.inner);
        let mut stmt = conn.prepare(
            "SELECT id, username, password_hash, created_at, disabled_at
               FROM users ORDER BY id ASC",
        )?;
        let rows = stmt
            .query_map([], |row| {
                Ok(UserRow {
                    id: row.get(0)?,
                    username: row.get(1)?,
                    password_hash: row.get(2)?,
                    created_at: row.get(3)?,
                    disabled_at: row.get(4)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    /// Phase B2: flip a user's disabled state. `disabled=true` stamps
    /// `disabled_at = now()`, `false` clears it back to `NULL`. Returns
    /// `Err` if no user has that name — callers should check
    /// [`Self::find_user`] first so a 404 surfaces cleanly instead of
    /// an opaque 500.
    pub fn update_disabled(&self, username: &str, disabled: bool) -> anyhow::Result<()> {
        let new_value: Option<i64> = if disabled { Some(unix_now()) } else { None };
        let conn = lock_or_recover(&self.inner);
        let updated = conn
            .execute(
                "UPDATE users SET disabled_at = ?1 WHERE username = ?2",
                params![new_value, username],
            )
            .with_context(|| format!("update disabled for '{username}'"))?;
        if updated == 0 {
            anyhow::bail!("update_disabled: no user named '{username}'");
        }
        Ok(())
    }

    /// Phase B2: scrub every persisted session that belongs to `username`.
    ///
    /// Used by both admin force-reset (so a leaked-credential reset
    /// actually kicks the attacker out everywhere) and admin disable
    /// (so a disabled user can't keep using a still-valid cookie).
    /// Returns the number of rows deleted — primarily for tests; the
    /// production callers don't act on the count, they just rely on the
    /// `Ok(_)` to know the cleanup ran.
    ///
    /// Implementation: the `sessions.data` BLOB is JSON-encoded by
    /// `tower_sessions::session_store`'s record serialiser (see
    /// [`super::session_store::SqliteSessionStore`]), so we enumerate,
    /// JSON-decode each row's data map, and DELETE the ids whose
    /// `SESSION_USER_KEY` value matches. Doing the match in Rust rather
    /// than via SQLite's optional `json1` extension keeps the binary
    /// portable across distros that build rusqlite without that
    /// feature flag.
    pub fn delete_sessions_for_user(&self, username: &str) -> anyhow::Result<usize> {
        let conn = lock_or_recover(&self.inner);
        // Phase 1: scan and collect ids whose JSON data matches.
        let ids: Vec<Vec<u8>> = {
            let mut stmt = conn.prepare("SELECT id, data FROM sessions")?;
            let iter = stmt.query_map([], |row| {
                let id: Vec<u8> = row.get(0)?;
                let data: Vec<u8> = row.get(1)?;
                Ok((id, data))
            })?;
            let mut keep = Vec::new();
            for row in iter {
                let (id, data) = row?;
                let Ok(map) = serde_json::from_slice::<HashMap<String, serde_json::Value>>(&data)
                else {
                    // A malformed row shouldn't ever exist (we control
                    // the writer) — log and skip rather than abort.
                    tracing::warn!(
                        "skipping malformed session row during delete_sessions_for_user"
                    );
                    continue;
                };
                if let Some(serde_json::Value::String(s)) = map.get(SESSION_USER_KEY) {
                    if s == username {
                        keep.push(id);
                    }
                }
            }
            keep
        };
        // Phase 2: batch-delete in a transaction so concurrent reads see
        // either all or none of the cleanup.
        if ids.is_empty() {
            return Ok(0);
        }
        let tx = conn.unchecked_transaction()?;
        for id in &ids {
            tx.execute(
                "DELETE FROM sessions WHERE id = ?1",
                params![id.as_slice()],
            )?;
        }
        tx.commit()?;
        Ok(ids.len())
    }

    /// Insert a new user. Returns the assigned id.
    /// `Err` on UNIQUE conflict — caller maps that to a 409.
    pub fn insert_user(&self, username: &str, password_hash: &str) -> anyhow::Result<i64> {
        let now = unix_now();
        let conn = lock_or_recover(&self.inner);
        conn.execute(
            "INSERT INTO users (username, password_hash, created_at)
             VALUES (?1, ?2, ?3)",
            params![username, password_hash, now],
        )
        .with_context(|| format!("insert user '{username}'"))?;
        Ok(conn.last_insert_rowid())
    }

    /// Replace a user's password hash. Used by the self-service change-password
    /// endpoint (Phase B1) and the future admin-reset endpoint (Phase B2).
    /// `Err` if the user does not exist — callers must already have authed
    /// the user and looked them up, so a missing row is an internal bug.
    pub fn update_password(&self, username: &str, password_hash: &str) -> anyhow::Result<()> {
        let conn = lock_or_recover(&self.inner);
        let updated = conn
            .execute(
                "UPDATE users SET password_hash = ?1 WHERE username = ?2",
                params![password_hash, username],
            )
            .with_context(|| format!("update password for '{username}'"))?;
        if updated == 0 {
            anyhow::bail!("update_password: no user named '{username}'");
        }
        Ok(())
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

    #[test]
    fn update_password_replaces_hash() {
        let db = tmp_db();
        db.insert_user("ktwu", "old-hash").unwrap();
        db.update_password("ktwu", "new-hash").unwrap();
        let row = db.find_user("ktwu").unwrap().expect("user present");
        assert_eq!(row.password_hash, "new-hash");
    }

    #[test]
    fn update_password_unknown_user_errors() {
        let db = tmp_db();
        let err = db.update_password("nobody", "new-hash");
        assert!(err.is_err(), "missing user must surface as Err");
    }

    // -------- Phase B2: admin endpoints support --------

    /// Re-opening a v1-shaped db (no disabled_at column) must idempotently
    /// add the column and leave existing data intact. Simulates the
    /// upgrade path on a real ktwu install.
    #[test]
    fn migration_adds_disabled_at_to_existing_db() {
        let path = std::env::temp_dir().join(format!(
            "ferdinand_authdb_migration_{}_{}.db",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        // Manually create the v1 schema (no disabled_at) + seed a user.
        {
            let conn = Connection::open(&path).unwrap();
            conn.execute_batch(
                "CREATE TABLE users (
                     id            INTEGER PRIMARY KEY AUTOINCREMENT,
                     username      TEXT NOT NULL UNIQUE,
                     password_hash TEXT NOT NULL,
                     created_at    INTEGER NOT NULL
                 );
                 CREATE TABLE sessions (
                     id          BLOB PRIMARY KEY,
                     data        BLOB NOT NULL,
                     expiry_date INTEGER NOT NULL
                 );",
            )
            .unwrap();
            conn.execute(
                "INSERT INTO users (username, password_hash, created_at) VALUES (?1,?2,?3)",
                params!["ktwu", "phc-placeholder", 1700000000_i64],
            )
            .unwrap();
        }
        // Now open via AuthDb — bootstrap_schema must add disabled_at.
        let db = AuthDb::open(&path).expect("reopen v1 db");
        let row = db.find_user("ktwu").unwrap().expect("seed user survives migration");
        assert_eq!(row.username, "ktwu");
        assert!(
            row.disabled_at.is_none(),
            "freshly migrated rows must be active"
        );
    }

    #[test]
    fn list_users_returns_all_in_id_order() {
        let db = tmp_db();
        db.insert_user("alice", "h-a").unwrap();
        db.insert_user("bob", "h-b").unwrap();
        db.insert_user("carol", "h-c").unwrap();
        let rows = db.list_users().unwrap();
        let names: Vec<_> = rows.iter().map(|r| r.username.as_str()).collect();
        assert_eq!(names, vec!["alice", "bob", "carol"]);
    }

    #[test]
    fn update_disabled_round_trip_visible_in_find_user() {
        let db = tmp_db();
        db.insert_user("friend", "h").unwrap();
        // Initially active.
        let row = db.find_user("friend").unwrap().unwrap();
        assert!(row.disabled_at.is_none());
        // Disable.
        db.update_disabled("friend", true).unwrap();
        let row = db.find_user("friend").unwrap().unwrap();
        assert!(row.disabled_at.is_some(), "after disable, disabled_at is set");
        // Re-enable.
        db.update_disabled("friend", false).unwrap();
        let row = db.find_user("friend").unwrap().unwrap();
        assert!(
            row.disabled_at.is_none(),
            "after re-enable, disabled_at is cleared"
        );
    }

    #[test]
    fn update_disabled_unknown_user_errors() {
        let db = tmp_db();
        let err = db.update_disabled("nobody", true);
        assert!(err.is_err(), "missing user must surface as Err");
    }

    /// Insert a hand-crafted session row whose `data` JSON has
    /// `SESSION_USER_KEY = username` so we can exercise
    /// `delete_sessions_for_user` without standing up the full
    /// tower-sessions Record machinery.
    fn insert_fake_session(db: &AuthDb, id: &[u8], username: &str) {
        let mut map: std::collections::HashMap<String, serde_json::Value> =
            std::collections::HashMap::new();
        map.insert(
            SESSION_USER_KEY.to_string(),
            serde_json::Value::String(username.to_string()),
        );
        let data = serde_json::to_vec(&map).unwrap();
        let conn = db.inner.lock().unwrap();
        conn.execute(
            "INSERT INTO sessions (id, data, expiry_date) VALUES (?1, ?2, ?3)",
            params![id, data, 9_999_999_999_i64],
        )
        .unwrap();
    }

    fn count_sessions(db: &AuthDb) -> i64 {
        let conn = db.inner.lock().unwrap();
        conn.query_row("SELECT COUNT(*) FROM sessions", [], |r| r.get(0))
            .unwrap()
    }

    #[test]
    fn delete_sessions_for_user_only_targets_named_user() {
        let db = tmp_db();
        // Three sessions: two for "victim", one for "bystander".
        insert_fake_session(&db, &[1u8; 16], "victim");
        insert_fake_session(&db, &[2u8; 16], "victim");
        insert_fake_session(&db, &[3u8; 16], "bystander");
        assert_eq!(count_sessions(&db), 3);
        let n = db.delete_sessions_for_user("victim").unwrap();
        assert_eq!(n, 2, "two victim rows deleted");
        assert_eq!(count_sessions(&db), 1, "bystander row preserved");
        // Idempotent: re-running on the now-empty user is a no-op.
        let n2 = db.delete_sessions_for_user("victim").unwrap();
        assert_eq!(n2, 0);
    }

    #[test]
    fn delete_sessions_for_user_with_no_matches_is_zero() {
        let db = tmp_db();
        // Empty sessions table → trivially zero.
        assert_eq!(db.delete_sessions_for_user("nobody").unwrap(), 0);
        // Even with rows present but for a different user.
        insert_fake_session(&db, &[7u8; 16], "alice");
        assert_eq!(db.delete_sessions_for_user("nobody").unwrap(), 0);
        assert_eq!(count_sessions(&db), 1);
    }
}
