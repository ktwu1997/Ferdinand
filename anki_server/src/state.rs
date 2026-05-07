use std::path::{Path, PathBuf};
use std::sync::Arc;

use anki::collection::{Collection, CollectionBuilder};
use anyhow::Context;
use tokio::sync::Mutex;

/// Handle to a single open Collection. Mutex-guarded because rslib's
/// `Collection` is not thread-safe by design (it owns a rusqlite handle).
///
/// Phase A1 layout: one collection per user, on disk at
/// `<users_dir>/<username>/collection.anki2`. The server still opens
/// exactly ONE user's collection per process — auth + per-request user
/// resolution land in Phase A2.
#[derive(Clone)]
pub struct AppState {
    pub col: Arc<Mutex<Collection>>,
    /// Canonicalised media directory (`<users_dir>/<username>/collection.media/`).
    /// Sibling of the .anki2 file inside the user's data directory.
    /// Used by `routes::media` to serve asset bytes. Created on startup
    /// if missing so fresh user dirs work without manual mkdir.
    pub media_dir: Arc<PathBuf>,
}

impl AppState {
    /// Open the collection living under `<users_dir>/<username>/`.
    /// Creates the user dir and media sibling on first run so a fresh
    /// user works without manual setup.
    pub fn open_for_user(
        users_dir: impl AsRef<Path>,
        username: &str,
    ) -> anyhow::Result<Self> {
        let user_dir = users_dir.as_ref().join(username);
        std::fs::create_dir_all(&user_dir)
            .with_context(|| format!("create user dir {}", user_dir.display()))?;
        let col_path = user_dir.join("collection.anki2");
        let col = CollectionBuilder::new(&col_path)
            .build()
            .with_context(|| format!("open collection at {}", col_path.display()))?;
        let media_dir = ensure_media_dir(&user_dir)?;
        Ok(Self {
            col: Arc::new(Mutex::new(col)),
            media_dir: Arc::new(media_dir),
        })
    }
}

fn ensure_media_dir(user_dir: &Path) -> anyhow::Result<PathBuf> {
    // Anki convention: collection.anki2 → collection.media/ as siblings.
    let media = user_dir.join("collection.media");
    std::fs::create_dir_all(&media)
        .with_context(|| format!("create media dir {}", media.display()))?;
    std::fs::canonicalize(&media)
        .with_context(|| format!("canonicalise media dir {}", media.display()))
}
