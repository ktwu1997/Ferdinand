use std::path::Path;
use std::sync::Arc;

use anki::collection::{Collection, CollectionBuilder};
use tokio::sync::Mutex;

/// Handle to a single open Collection. Mutex-guarded because rslib's
/// `Collection` is not thread-safe by design (it owns a rusqlite handle).
///
/// In Phase 1 we keep ONE Collection per server instance — matches the
/// "localhost single-user" decision. Multi-profile picker comes in Phase 3.
#[derive(Clone)]
pub struct AppState {
    pub col: Arc<Mutex<Collection>>,
}

impl AppState {
    pub fn open(path: impl AsRef<Path>) -> anyhow::Result<Self> {
        let col = CollectionBuilder::new(path.as_ref()).build()?;
        Ok(Self {
            col: Arc::new(Mutex::new(col)),
        })
    }
}
