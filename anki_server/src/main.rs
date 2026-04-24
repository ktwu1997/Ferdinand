// anki_server — Phase 1 of the web+iOS redesign.
// Owns a single Collection and exposes it as a REST API to the web client
// (mockup/ today, eventually the real web app) and, later, the iOS app.

mod bootstrap;
mod error;
mod routes;
mod state;

use std::net::SocketAddr;

use anyhow::Context;
use axum::Router;
use clap::Parser;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;
use tracing_subscriber::EnvFilter;

use crate::state::AppState;

/// CLI surface for the anki_server binary. Accepts `--collection <path>`
/// which takes precedence over the `ANKI_COLLECTION` env var when both are
/// set, so dev scripts and one-off invocations can override the env without
/// unsetting it (Phase 8-F).
#[derive(Parser, Debug)]
#[command(about = "Ferdinand anki_server — REST API around a single Anki collection")]
struct Cli {
    /// Path to a `collection.anki2` file. Overrides `ANKI_COLLECTION`.
    #[arg(long, value_name = "PATH")]
    collection: Option<String>,
}

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

    // CLI flag wins over env var; either must be present.
    let collection_path = cli
        .collection
        .or_else(|| std::env::var("ANKI_COLLECTION").ok())
        .context("collection path required: pass --collection <path> or set ANKI_COLLECTION")?;
    let port: u16 = std::env::var("ANKI_SERVER_PORT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(40001);

    let state = AppState::open(&collection_path)
        .with_context(|| format!("failed to open collection at {collection_path}"))?;
    {
        let mut col = state.col.lock().await;
        bootstrap::seed_if_requested(&mut col)?;
    }

    let app = Router::new()
        .merge(routes::router())
        .layer(TraceLayer::new_for_http())
        .layer(CorsLayer::very_permissive())
        .with_state(state);

    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let listener = tokio::net::TcpListener::bind(addr).await?;
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
