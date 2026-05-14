//! Integration test — concurrent first-use of the same user must not open
//! the same `collection.anki2` twice (SQLite WAL exclusive-write lock would
//! cause the loser to block indefinitely).
//!
//! Verifies the per-user `Arc<tokio::sync::Mutex<Option<AppState>>>` fix
//! in `state.rs`: 50 concurrent tasks all calling `app_state_for("alice")`
//! must receive `Ok`, and all returned `AppState`s must share the same
//! underlying `Arc<Mutex<Collection>>` pointer — proving only one open happened.

use std::sync::Arc;

use anki_server::state::ServerState;

// ── helpers ─────────────────────────────────────────────────────────────────

fn tmp_dir(tag: &str) -> std::path::PathBuf {
    let p = std::env::temp_dir().join(format!(
        "ferdinand_{tag}_{}_{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&p).unwrap();
    p
}

fn tmp_auth_db() -> anki_server::auth::db::AuthDb {
    let path = std::env::temp_dir().join(format!(
        "ferdinand_concurrent_authdb_{}_{}.db",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    anki_server::auth::db::AuthDb::open(&path).unwrap()
}

// ── test ─────────────────────────────────────────────────────────────────────

#[tokio::test(flavor = "multi_thread", worker_threads = 8)]
async fn concurrent_first_use_opens_collection_once() {
    let server = Arc::new(ServerState::new(tmp_auth_db(), tmp_dir("concurrent_users")));
    let user = "alice";

    // 50 concurrent tasks all ask for the same user simultaneously.
    let handles: Vec<_> = (0..50)
        .map(|_| {
            let s = server.clone();
            tokio::spawn(async move { s.app_state_for(user).await })
        })
        .collect();

    let results: Vec<anyhow::Result<anki_server::state::AppState>> =
        futures::future::join_all(handles)
            .await
            .into_iter()
            .map(|r| r.expect("task did not panic"))
            .collect();

    // All 50 must succeed.
    for (i, r) in results.iter().enumerate() {
        assert!(r.is_ok(), "task {i} returned Err: {:?}", r.as_ref().err());
    }

    // All must share the same Arc<Mutex<Collection>> pointer — exactly one
    // collection was built.
    let first_col = results[0].as_ref().unwrap().col.clone();
    for (i, r) in results[1..].iter().enumerate() {
        assert!(
            Arc::ptr_eq(&first_col, &r.as_ref().unwrap().col),
            "task {i}: got a different Arc — collection was opened more than once"
        );
    }
}
