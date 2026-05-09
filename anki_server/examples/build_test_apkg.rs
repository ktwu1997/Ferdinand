//! Build a tiny modern `.apkg` fixture for the a12 e2e test.
//!
//! The upstream `pylib/tests/support/*.apkg` fixtures are Anki 2.0-era
//! (2012-2013) and modern rslib's `import_apkg` refuses them with
//! `AnkiError::InvalidInput`. The a12 happy-path case needs a known-good
//! fresh `.apkg` generated against the current schema, so we synthesise
//! one here from a temp Collection.
//!
//! Run via:
//!   cargo run -p anki_server --example build_test_apkg -- mockup/tests/fixtures/sample.apkg

use std::path::PathBuf;
use std::sync::Arc;

use anki::collection::{Collection, CollectionBuilder};
use anki::decks::{Deck, NativeDeckName};
use anki::import_export::package::ExportAnkiPackageOptions;
use anki::notetype::Notetype;
use anki::search::SearchNode;

fn main() -> anyhow::Result<()> {
    let out: PathBuf = std::env::args()
        .nth(1)
        .ok_or_else(|| anyhow::anyhow!("usage: build_test_apkg <out_path>"))?
        .into();
    if let Some(parent) = out.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let tmp = tempfile::tempdir()?;
    let col_path = tmp.path().join("col.anki2");
    let mut col = CollectionBuilder::new(&col_path).build()?;

    let notetype = pick_front_back_notetype(&mut col)?;

    let mut deck = Deck::new_normal();
    deck.name = NativeDeckName::from_human_name("B3a sample");
    col.add_deck(&mut deck)?;
    let deck_id = deck.id;

    let mut note = notetype.new_note();
    note.set_field(0, "B3a sample front")?;
    note.set_field(1, "B3a sample back")?;
    col.add_note(&mut note, deck_id)?;

    // Match the rslib roundtrip test's options. `with_media: false`
    // produces a collection.anki2 that references media files that
    // aren't in the zip — the importer then raises InvalidInput
    // ("X missing from archive"). Keeping all three on (and legacy off)
    // produces a self-contained modern .apkg that re-imports cleanly.
    col.export_apkg(
        &out,
        ExportAnkiPackageOptions {
            with_scheduling: true,
            with_deck_configs: true,
            with_media: true,
            legacy: false,
        },
        SearchNode::WholeCollection,
        None,
    )?;

    let size = std::fs::metadata(&out)?.len();
    eprintln!("wrote {} ({} bytes)", out.display(), size);
    Ok(())
}

fn pick_front_back_notetype(col: &mut Collection) -> anyhow::Result<Arc<Notetype>> {
    if let Some(nt) = col.get_notetype_by_name("Basic")? {
        return Ok(nt);
    }
    use anki::notetype::NotetypeKind;
    for nt in col.get_all_notetypes()? {
        let is_cloze = matches!(nt.config.kind(), NotetypeKind::Cloze);
        if nt.fields.len() >= 2 && !is_cloze {
            return Ok(nt);
        }
    }
    anyhow::bail!("no 2-field notetype in fresh collection")
}
