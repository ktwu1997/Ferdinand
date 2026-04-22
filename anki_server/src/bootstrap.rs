//! One-shot sample data seeding.
//! Runs when `ANKI_SERVER_BOOTSTRAP=1` is set AND the named deck doesn't yet
//! exist, so it's safe to leave enabled during dev without wiping real work.

use anki::collection::Collection;
use anki::decks::{Deck, NativeDeckName};
use anki::prelude::DeckId;

const DEMO_DECK: &str = "Ferdinand demo";

const SAMPLE_NOTES: &[(&str, &str)] = &[
    ("森林", "しんりん — forest, woods"),
    ("海", "うみ — sea, ocean"),
    ("山", "やま — mountain"),
    ("懐かしい", "なつかしい — nostalgic, dear, missed"),
    (
        "What is Rust's ownership rule about borrows?",
        "At any time you can have either (1) any number of immutable references, or (2) exactly one mutable reference. Not both.",
    ),
    (
        "Date of the fall of Constantinople",
        "1453 — Mehmed II's Ottoman forces breached the walls on 29 May.",
    ),
];

/// Seed `DEMO_DECK` with basic notes if it's missing. Idempotent.
pub fn seed_if_requested(col: &mut Collection) -> anyhow::Result<()> {
    if std::env::var("ANKI_SERVER_BOOTSTRAP").ok().as_deref() != Some("1") {
        return Ok(());
    }
    let existing = col.get_deck_id(DEMO_DECK)?;
    let deck_id = match existing {
        Some(id) => {
            // Seed only if the deck is empty — supports retrying after an earlier
            // failure where the deck got created but notes didn't.
            let cid_count = col
                .search_cards(
                    format!("deck:\"{DEMO_DECK}\"").as_str(),
                    anki::search::SortMode::NoOrder,
                )?
                .len();
            if cid_count > 0 {
                tracing::info!(
                    deck = DEMO_DECK,
                    cards = cid_count,
                    "bootstrap skipped: deck has cards"
                );
                return Ok(());
            }
            id
        }
        None => create_deck(col, DEMO_DECK)?,
    };
    // "Basic" is translated by locale (e.g. "基礎" in zh-TW). Fall back to the
    // first 2-field notetype we find — works on any localized collection.
    let notetype = pick_front_back_notetype(col)?;

    for (front, back) in SAMPLE_NOTES {
        let mut note = notetype.new_note();
        note.set_field(0, *front)?;
        note.set_field(1, *back)?;
        col.add_note(&mut note, deck_id)?;
    }

    tracing::info!(
        deck = DEMO_DECK,
        count = SAMPLE_NOTES.len(),
        "bootstrap seeded"
    );
    Ok(())
}

fn create_deck(col: &mut Collection, name: &str) -> anyhow::Result<DeckId> {
    let mut deck = Deck::new_normal();
    deck.name = NativeDeckName::from_human_name(name);
    col.add_deck(&mut deck)?;
    Ok(deck.id)
}

fn pick_front_back_notetype(
    col: &mut Collection,
) -> anyhow::Result<std::sync::Arc<anki::notetype::Notetype>> {
    // Try the English name first (most collections).
    if let Some(nt) = col.get_notetype_by_name("Basic")? {
        return Ok(nt);
    }
    // Otherwise: first 2-field, non-cloze notetype.
    use anki::notetype::NotetypeKind;
    for nt in col.get_all_notetypes()? {
        let is_cloze = matches!(nt.config.kind(), NotetypeKind::Cloze);
        if nt.fields.len() >= 2 && !is_cloze {
            return Ok(nt);
        }
    }
    Err(anyhow::anyhow!(
        "no 2-field notetype available in this collection"
    ))
}
