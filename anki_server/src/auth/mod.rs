//! Phase A2: cookie-session auth.
//!
//! Layout
//! ------
//! * `db`            – sqlite-backed `users` table (rusqlite, separate file
//!   from the user's `collection.anki2` so a corrupt collection never knocks
//!   out login).
//! * `password`      – argon2id hash + verify helpers.
//! * `session_store` – `tower_sessions::SessionStore` impl backed by the same
//!   `auth.db`. Sessions outlive process restarts so the user doesn't have
//!   to re-log every time `cargo run` cycles.
//! * `middleware`    – `require_auth` axum layer. Reads `Session::get(USER_KEY)`
//!   and either injects the username into request extensions or returns 401.
//! * `routes`        – the four `/api/auth/*` HTTP endpoints.
//!
//! Why a separate auth.db
//! ----------------------
//! User asked: "data/auth.db (放 users-dir 之外，避免跟 collection 混)".
//! Each user's collection is per-user; auth state is global. Splitting the
//! files keeps the boundary obvious and avoids accidentally serializing
//! session writes against an Anki collection lock.

pub mod db;
pub mod middleware;
pub mod password;
pub mod rate_limit;
pub mod routes;
pub mod session_store;

/// Session key under which the authenticated username is stored.
/// Centralised so the middleware and the login handler agree.
pub const SESSION_USER_KEY: &str = "user";
