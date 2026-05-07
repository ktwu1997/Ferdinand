// anki_server — REST backend for the Ferdinand web + iOS clients.
//
// Phase A1 introduced per-user collection layout (`<users-dir>/<username>/`).
// Phase A2 builds on that with sqlite-backed auth + cookie sessions:
//
//   * `/api/auth/{register,login,logout,me}` and `/api/health` are public
//     (no auth required to reach login).
//   * Every other `/api/*` route — and the `/media/*` static range —
//     sit behind a `require_auth` middleware that resolves the session
//     cookie to a username.
//   * The `AppState` extractor (see `state.rs`) lazily opens that user's
//     collection on first request and caches it for the server's lifetime.

mod auth;
mod bootstrap;
mod error;
mod routes;
mod seed_notetypes;
mod state;
mod static_assets;

use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::path::PathBuf;

use anyhow::Context;
use axum::Router;
use clap::Parser;
use time::Duration;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;
use tower_sessions::{Expiry, SessionManagerLayer};
use tracing_subscriber::EnvFilter;

use crate::auth::db::AuthDb;
use crate::auth::session_store::SqliteSessionStore;
use crate::state::ServerState;

/// CLI surface for the anki_server binary.
///
/// `--users-dir` and `--auth-db` both prefer their explicit value over the
/// matching env var (`ANKI_USERS_DIR`, `ANKI_AUTH_DB`), with sensible
/// in-repo defaults so a bare `cargo run -p anki_server` works.
#[derive(Parser, Debug)]
#[command(about = "Ferdinand anki_server — REST API around per-user Anki collections")]
struct Cli {
    /// Directory holding per-user subdirs (`<users_dir>/<username>/collection.anki2`).
    /// Overrides `ANKI_USERS_DIR`.
    #[arg(long, value_name = "PATH")]
    users_dir: Option<String>,

    /// Sqlite file holding the users + sessions tables. Overrides
    /// `ANKI_AUTH_DB`. Default `<users_dir>/../auth.db` so the auth db
    /// stays adjacent to but separate from the collections.
    #[arg(long, value_name = "PATH")]
    auth_db: Option<String>,
}

/// Default users-dir when neither `--users-dir` nor `ANKI_USERS_DIR` is set.
const DEFAULT_USERS_DIR: &str = "data/users";

/// Default auth-db path. Sits next to `users-dir`, not inside it, so a
/// "delete the users directory" wipe doesn't take auth state with it.
const DEFAULT_AUTH_DB: &str = "data/auth.db";

/// Session cookie name. Stable across restarts so a logged-in user stays
/// logged in when we cycle the binary in dev.
const SESSION_COOKIE: &str = "ferdinand_session";

fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    // rslib (via our dep tree) pulls in code paths that can exhaust
    // the default 8 MiB main-thread stack during first-use static init.
    // Run the tokio runtime on a thread with a generous stack.
    let thread = std::thread::Builder::new()
        .name("anki_server_main".into())
        .stack_size(32 * 1024 * 1024)
        .spawn(move || {
            tokio::runtime::Builder::new_multi_thread()
                .thread_stack_size(16 * 1024 * 1024)
                .enable_all()
                .build()
                .expect("tokio runtime")
                .block_on(run(cli))
        })?;
    thread.join().expect("anki_server_main panicked")
}

async fn run(cli: Cli) -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("info,anki_server=debug")),
        )
        .compact()
        .init();

    let users_dir = cli
        .users_dir
        .or_else(|| std::env::var("ANKI_USERS_DIR").ok())
        .unwrap_or_else(|| DEFAULT_USERS_DIR.to_string());
    let auth_db_path = resolve_auth_db_path(cli.auth_db.as_deref(), &users_dir);

    let port: u16 = std::env::var("ANKI_SERVER_PORT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(40001);
    // Default to loopback so a stock dev run is never reachable from LAN.
    // Set `ANKI_BIND=0.0.0.0` (or a specific interface IP) to expose to LAN
    // for iPhone testing on the same WiFi.
    let bind: IpAddr = match std::env::var("ANKI_BIND").ok().as_deref() {
        Some(s) if !s.is_empty() => s
            .parse()
            .with_context(|| format!("ANKI_BIND='{s}' is not a valid IP address"))?,
        _ => IpAddr::V4(Ipv4Addr::LOCALHOST),
    };

    // Fail fast if `users_dir` is unwritable. We don't open a Collection
    // here (that's per-user, deferred to first request via `AppState`'s
    // extractor) but we do want a misconfigured path to surface at boot
    // rather than silently 500-ing the first authenticated request.
    std::fs::create_dir_all(&users_dir)
        .with_context(|| format!("failed to create users-dir at {users_dir}"))?;

    // Open auth db + build session store on the same file. Schema bootstrap
    // is idempotent so this is safe across restarts and across `cargo test`.
    let auth = AuthDb::open(&auth_db_path)
        .with_context(|| format!("open auth db at {auth_db_path}"))?;
    tracing::info!(path = %auth_db_path, "auth db ready");

    seed_user_if_requested(&auth)?;

    let session_store = SqliteSessionStore::new(&auth);
    // Note: cookies are unsigned. The session id is a 128-bit random integer,
    // so tampering doesn't yield anything useful. Signing would require
    // pulling the `signed` feature plus a key-management surface that
    // Phase A2 doesn't otherwise need (YAGNI). Caddy handles TLS in front;
    // the cookie only ever crosses 127.0.0.1 in plaintext.
    let session_layer = SessionManagerLayer::new(session_store)
        .with_name(SESSION_COOKIE)
        .with_http_only(true)
        .with_secure(false)
        .with_same_site(tower_sessions::cookie::SameSite::Lax)
        .with_expiry(Expiry::OnInactivity(Duration::days(30)));

    let server_state = ServerState::new(auth, PathBuf::from(&users_dir));

    // Public routes (no auth gate): /api/auth/{register,login,logout} + /api/health
    // come from `auth::routes::public_router()` and `routes::public_router()`.
    let public = auth::routes::public_router().merge(routes::public_router());
    // Protected routes: everything that touches a Collection + /api/auth/me.
    // The collection routes inherit the gate via `AppState`'s extractor,
    // but we still wrap them in `require_auth` so a misconfiguration can't
    // let an unauth request leak even an error from inside a handler.
    let protected = routes::router()
        .merge(auth::routes::protected_router())
        .layer(axum::middleware::from_fn(auth::middleware::require_auth));

    let api = Router::new().merge(public).merge(protected);

    let app = static_assets::attach(api)
        .layer(session_layer)
        .layer(TraceLayer::new_for_http())
        .layer(CorsLayer::very_permissive())
        .with_state(server_state);

    let addr = SocketAddr::new(bind, port);
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .with_context(|| format!("failed to bind {addr}"))?;
    if !bind.is_loopback() {
        tracing::warn!(%addr, "anki_server bound to non-loopback — auth required, ensure TLS in front");
    }
    tracing::info!(%addr, users_dir = %users_dir, "anki_server listening on {addr}");
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    Ok(())
}

/// Resolve the auth-db path with the same precedence as `users-dir`:
/// CLI flag → env var → default. The default sits next to `users_dir` so
/// `--users-dir /opt/ferdinand/users` implies `/opt/ferdinand/auth.db`.
fn resolve_auth_db_path(cli: Option<&str>, users_dir: &str) -> String {
    if let Some(path) = cli {
        return path.to_string();
    }
    if let Ok(path) = std::env::var("ANKI_AUTH_DB") {
        if !path.is_empty() {
            return path;
        }
    }
    // Sibling of `users_dir`: e.g. `data/users` → `data/auth.db`.
    let users_path = PathBuf::from(users_dir);
    match users_path.parent() {
        Some(parent) if !parent.as_os_str().is_empty() => parent
            .join("auth.db")
            .to_string_lossy()
            .into_owned(),
        _ => DEFAULT_AUTH_DB.to_string(),
    }
}

/// If `FERDINAND_SEED_USER` (default `ktwu`) is missing from the auth db
/// and `FERDINAND_SEED_PASSWORD` is set, create that user. Idempotent —
/// safe to run on every boot.
fn seed_user_if_requested(auth: &AuthDb) -> anyhow::Result<()> {
    let Ok(password) = std::env::var("FERDINAND_SEED_PASSWORD") else {
        return Ok(());
    };
    if password.is_empty() {
        return Ok(());
    }
    let username =
        std::env::var("FERDINAND_SEED_USER").unwrap_or_else(|_| "ktwu".to_string());
    if auth.find_user(&username)?.is_some() {
        tracing::info!(user = %username, "seed user already present, skipping");
        return Ok(());
    }
    let hash = auth::password::hash(&password)?;
    auth.insert_user(&username, &hash)?;
    tracing::info!(user = %username, "seed user created from FERDINAND_SEED_PASSWORD");
    Ok(())
}

async fn shutdown_signal() {
    tokio::signal::ctrl_c().await.ok();
    tracing::info!("shutdown signal received");
}
