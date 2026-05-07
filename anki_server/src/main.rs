// anki_server — REST backend for the Ferdinand web + iOS clients.
// Phase A1: opens ONE per-user collection (`<users_dir>/<username>/collection.anki2`)
// and exposes it as a REST API. Phase A2 will add session-based auth and
// per-request user resolution; deck sharing happens via .apkg export/import.

mod bootstrap;
mod error;
mod routes;
mod seed_notetypes;
mod state;
mod static_assets;

use std::net::{IpAddr, Ipv4Addr, SocketAddr};

use anyhow::Context;
use axum::Router;
use clap::Parser;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;
use tracing_subscriber::EnvFilter;

use crate::state::AppState;

/// CLI surface for the anki_server binary. Accepts `--users-dir <path>`
/// which takes precedence over the `ANKI_USERS_DIR` env var when both are
/// set, so dev scripts and one-off invocations can override the env without
/// unsetting it. Default = `data/users` relative to the current working
/// directory, matching the in-repo Phase A1 layout.
#[derive(Parser, Debug)]
#[command(about = "Ferdinand anki_server — REST API around per-user Anki collections")]
struct Cli {
    /// Directory holding per-user subdirs (`<users_dir>/<username>/collection.anki2`).
    /// Overrides `ANKI_USERS_DIR`.
    #[arg(long, value_name = "PATH")]
    users_dir: Option<String>,
}

/// Phase A1 hardcoded user. Phase A2 replaces this with a session-resolved
/// user from tower-sessions.
const PHASE_A1_HARDCODED_USER: &str = "ktwu";

/// Default users-dir when neither `--users-dir` nor `ANKI_USERS_DIR` is set.
const DEFAULT_USERS_DIR: &str = "data/users";

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

    // CLI flag wins over env var; falls back to the in-repo default so a
    // bare `cargo run -p anki_server` works out of the box.
    let users_dir = cli
        .users_dir
        .or_else(|| std::env::var("ANKI_USERS_DIR").ok())
        .unwrap_or_else(|| DEFAULT_USERS_DIR.to_string());
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

    let state = AppState::open_for_user(&users_dir, PHASE_A1_HARDCODED_USER)
        .with_context(|| {
            format!(
                "failed to open collection for user '{PHASE_A1_HARDCODED_USER}' under {users_dir}"
            )
        })?;
    {
        let mut col = state.col.lock().await;
        bootstrap::seed_if_requested(&mut col)?;
        seed_notetypes::seed_if_missing(&mut col)?;
    }

    let api = Router::new().merge(routes::router());
    let app = static_assets::attach(api)
        .layer(TraceLayer::new_for_http())
        .layer(CorsLayer::very_permissive())
        .with_state(state);

    let addr = SocketAddr::new(bind, port);
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .with_context(|| format!("failed to bind {addr}"))?;
    if !bind.is_loopback() {
        tracing::warn!(%addr, "anki_server bound to non-loopback — LAN-reachable, no auth");
    }
    tracing::info!(%addr, "anki_server listening on {addr}");
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    Ok(())
}

async fn shutdown_signal() {
    tokio::signal::ctrl_c().await.ok();
    tracing::info!("shutdown signal received");
}
