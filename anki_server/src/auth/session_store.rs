//! `tower_sessions::SessionStore` implementation backed by the same
//! sqlite file as [`super::db::AuthDb`].
//!
//! Records are stored as JSON blobs (the in-memory `Record::data` is already
//! a `HashMap<String, serde_json::Value>`, so JSON is the lowest-friction
//! serialisation). Expiry is stored as a Unix timestamp seconds value so
//! we can index it for the eventual GC sweep.
//!
//! Why roll our own
//! ----------------
//! `tower-sessions` ships an sqlx-backed sqlite store, but pulling sqlx
//! into a workspace that already uses rusqlite would double the SQLite
//! surface area. ~80 LoC of trait impl is cheaper than that.

use std::sync::Arc;
use std::sync::Mutex;

use async_trait::async_trait;
use rusqlite::{params, Connection, OptionalExtension};
use time::OffsetDateTime;
use tower_sessions::session::{Id, Record};
use tower_sessions::session_store::{Error as StoreError, Result as StoreResult};
use tower_sessions::SessionStore;

use super::db::AuthDb;

/// Sqlite-backed session store. Cheap to clone (`Arc<Mutex<Connection>>`).
#[derive(Clone, Debug)]
pub struct SqliteSessionStore {
    conn: Arc<Mutex<Connection>>,
}

impl SqliteSessionStore {
    pub fn new(db: &AuthDb) -> Self {
        Self { conn: db.conn() }
    }
}

fn map_backend(e: impl std::fmt::Display) -> StoreError {
    StoreError::Backend(e.to_string())
}

fn map_encode(e: impl std::fmt::Display) -> StoreError {
    StoreError::Encode(e.to_string())
}

fn map_decode(e: impl std::fmt::Display) -> StoreError {
    StoreError::Decode(e.to_string())
}

#[async_trait]
impl SessionStore for SqliteSessionStore {
    async fn create(&self, record: &mut Record) -> StoreResult<()> {
        // Loop on UNIQUE collisions so a malicious / unlucky client can't
        // crash the store by guessing an existing id. Collisions are
        // astronomically rare — 1 retry is enough in practice but we cap at 8.
        for _ in 0..8 {
            let serialised = serde_json::to_vec(&record.data).map_err(map_encode)?;
            let id_bytes = record.id.0.to_le_bytes();
            let expiry = record.expiry_date.unix_timestamp();
            let conn = self.conn.clone();
            let inserted = tokio::task::spawn_blocking(move || -> StoreResult<bool> {
                let conn = conn.lock().expect("session store poisoned");
                let res = conn.execute(
                    "INSERT INTO sessions (id, data, expiry_date) VALUES (?1, ?2, ?3)",
                    params![id_bytes.as_slice(), serialised, expiry],
                );
                match res {
                    Ok(_) => Ok(true),
                    Err(rusqlite::Error::SqliteFailure(err, _))
                        if err.code == rusqlite::ErrorCode::ConstraintViolation =>
                    {
                        Ok(false)
                    }
                    Err(e) => Err(map_backend(e)),
                }
            })
            .await
            .map_err(map_backend)??;
            if inserted {
                return Ok(());
            }
            // Collision: regenerate id and retry.
            record.id = Id::default();
        }
        Err(StoreError::Backend(
            "session id collision after 8 retries".to_string(),
        ))
    }

    async fn save(&self, record: &Record) -> StoreResult<()> {
        let serialised = serde_json::to_vec(&record.data).map_err(map_encode)?;
        let id_bytes = record.id.0.to_le_bytes();
        let expiry = record.expiry_date.unix_timestamp();
        let conn = self.conn.clone();
        tokio::task::spawn_blocking(move || -> StoreResult<()> {
            let conn = conn.lock().expect("session store poisoned");
            conn.execute(
                "INSERT INTO sessions (id, data, expiry_date) VALUES (?1, ?2, ?3)
                 ON CONFLICT(id) DO UPDATE SET
                    data        = excluded.data,
                    expiry_date = excluded.expiry_date",
                params![id_bytes.as_slice(), serialised, expiry],
            )
            .map_err(map_backend)?;
            Ok(())
        })
        .await
        .map_err(map_backend)?
    }

    async fn load(&self, session_id: &Id) -> StoreResult<Option<Record>> {
        let id_bytes = session_id.0.to_le_bytes();
        let id = *session_id;
        let conn = self.conn.clone();
        tokio::task::spawn_blocking(move || -> StoreResult<Option<Record>> {
            let conn = conn.lock().expect("session store poisoned");
            let row = conn
                .query_row(
                    "SELECT data, expiry_date FROM sessions WHERE id = ?1",
                    params![id_bytes.as_slice()],
                    |row| {
                        let data: Vec<u8> = row.get(0)?;
                        let expiry: i64 = row.get(1)?;
                        Ok((data, expiry))
                    },
                )
                .optional()
                .map_err(map_backend)?;
            let Some((data, expiry)) = row else {
                return Ok(None);
            };
            let expiry_date =
                OffsetDateTime::from_unix_timestamp(expiry).map_err(map_decode)?;
            // Drop expired sessions on read so callers see them as gone.
            // Authoritative cleanup is the GC sweep; this is just defence
            // in depth so an expired session never authenticates anyone.
            if expiry_date <= OffsetDateTime::now_utc() {
                return Ok(None);
            }
            let data = serde_json::from_slice(&data).map_err(map_decode)?;
            Ok(Some(Record {
                id,
                data,
                expiry_date,
            }))
        })
        .await
        .map_err(map_backend)?
    }

    async fn delete(&self, session_id: &Id) -> StoreResult<()> {
        let id_bytes = session_id.0.to_le_bytes();
        let conn = self.conn.clone();
        tokio::task::spawn_blocking(move || -> StoreResult<()> {
            let conn = conn.lock().expect("session store poisoned");
            conn.execute(
                "DELETE FROM sessions WHERE id = ?1",
                params![id_bytes.as_slice()],
            )
            .map_err(map_backend)?;
            Ok(())
        })
        .await
        .map_err(map_backend)?
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use time::Duration;

    fn tmp_store() -> SqliteSessionStore {
        let path = std::env::temp_dir().join(format!(
            "ferdinand_session_store_test_{}_{}.db",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let db = AuthDb::open(&path).unwrap();
        SqliteSessionStore::new(&db)
    }

    fn record_with(value: &str) -> Record {
        let mut data = HashMap::new();
        data.insert("user".into(), serde_json::Value::String(value.into()));
        Record {
            id: Id::default(),
            data,
            expiry_date: OffsetDateTime::now_utc() + Duration::hours(1),
        }
    }

    #[tokio::test]
    async fn create_then_load_round_trip() {
        let store = tmp_store();
        let mut record = record_with("ktwu");
        store.create(&mut record).await.unwrap();
        let loaded = store.load(&record.id).await.unwrap().expect("loaded");
        assert_eq!(loaded.id, record.id);
        assert_eq!(
            loaded.data.get("user"),
            Some(&serde_json::Value::String("ktwu".into()))
        );
    }

    #[tokio::test]
    async fn save_overwrites_existing_record() {
        let store = tmp_store();
        let mut record = record_with("ktwu");
        store.create(&mut record).await.unwrap();
        record
            .data
            .insert("user".into(), serde_json::Value::String("alice".into()));
        store.save(&record).await.unwrap();
        let loaded = store.load(&record.id).await.unwrap().unwrap();
        assert_eq!(
            loaded.data.get("user"),
            Some(&serde_json::Value::String("alice".into()))
        );
    }

    #[tokio::test]
    async fn delete_removes_record() {
        let store = tmp_store();
        let mut record = record_with("ktwu");
        store.create(&mut record).await.unwrap();
        store.delete(&record.id).await.unwrap();
        assert!(store.load(&record.id).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn expired_record_loads_as_none() {
        let store = tmp_store();
        let mut record = record_with("ktwu");
        record.expiry_date = OffsetDateTime::now_utc() - Duration::hours(1);
        store.create(&mut record).await.unwrap();
        assert!(store.load(&record.id).await.unwrap().is_none());
    }
}
