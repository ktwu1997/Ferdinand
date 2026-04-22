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
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;
use tracing_subscriber::EnvFilter;

use crate::state::AppState;

fn main() -> anyhow::Result<()> {
    // rslib (via our dep tree) pulls in code paths that can exhaust
    // the default 8 MiB main-thread stack during first-use static init.
    // Run the tokio runtime on a thread with a generous stack.
    let thread = std::thread::Builder::new()
        .name("anki_server_main".into())
        .stack_size(32 * 1024 * 1024)
        .spawn(|| {
            tokio::runtime::Builder::new_multi_thread()
                .thread_stack_size(16 * 1024 * 1024)
                .enable_all()
                .build()
                .expect("tokio runtime")
                .block_on(run())
        })?;
    thread.join().expect("anki_server_main panicked")
}

async fn run() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info,anki_server=debug")),
        )
        .compact()
        .init();

    let collection_path = std::env::var("ANKI_COLLECTION")
        .context("ANKI_COLLECTION env var must point to a collection.anki2 file")?;
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
