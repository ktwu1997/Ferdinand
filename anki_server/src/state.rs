use std::path::{Path, PathBuf};
use std::sync::Arc;

use anki::collection::{Collection, CollectionBuilder};
use anyhow::Context;
use tokio::sync::Mutex;

/// Handle to a single open Collection. Mutex-guarded because rslib's
/// `Collection` is not thread-safe by design (it owns a rusqlite handle).
///
/// In Phase 1 we keep ONE Collection per server instance — matches the
/// "localhost single-user" decision. Multi-profile picker comes in Phase 3.
#[derive(Clone)]
pub struct AppState {
    pub col: Arc<Mutex<Collection>>,
    /// Canonicalised media directory (`<collection-stem>.media/`) — the
    /// sibling of the .anki2 file that holds images, audio, and video.
    /// Used by `routes::media` to serve asset bytes. Created on startup
    /// if missing so fresh collections work without manual mkdir.
    pub media_dir: Arc<PathBuf>,
}

impl AppState {
    pub fn open(path: impl AsRef<Path>) -> anyhow::Result<Self> {
        let path = path.as_ref();
        let col = CollectionBuilder::new(path).build()?;
        let media_dir = derive_media_dir(path)?;
        Ok(Self {
            col: Arc::new(Mutex::new(col)),
            media_dir: Arc::new(media_dir),
        })
    }
}

fn derive_media_dir(col_path: &Path) -> anyhow::Result<PathBuf> {
    // Anki convention: `foo.anki2` → `foo.media/`.
    let media = col_path.with_extension("media");
    std::fs::create_dir_all(&media)
        .with_context(|| format!("create media dir {}", media.display()))?;
    std::fs::canonicalize(&media)
        .with_context(|| format!("canonicalise media dir {}", media.display()))
}
