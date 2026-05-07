//! Phase 12-C: note creation. POST /api/notes accepts a deck id, a
//! field array, and an optional tag list, then persists the note via
//! `Collection::add_note` — Anki's transactional add path that also
//! generates the cards required by the note's notetype templates.
//!
//! Notetype selection: callers may pass an explicit `notetype_id`, but
//! the v1 home-page Add Note flow doesn't require one — when absent,
//! the server falls back to the notetype named "Basic" (Anki's seeded
//! default). This keeps the home page's "Add note" button zero-config
//! while letting future flows (Cloze, custom notetypes) override.
//! Notetype ids in the wild are epoch-ms timestamps, NOT small
//! integers — early drafts of this endpoint hardcoded 1 as the default
//! and immediately 404'd against any real collection.

use anki::decks::DeckKind;
use anki::notes::Note;
use anki::notetype::NotetypeId;
use anki::prelude::*;
use axum::extract::{Path};
use axum::Json;
use serde::{Deserialize, Serialize};

use crate::error::{ApiResult, ServerError};
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct NoteCreateRequest {
    /// Target deck id. Must point to a non-filtered deck.
    pub deck_id: i64,
    /// Field values in template order. Length must match the chosen
    /// notetype's field count exactly. The first field is the sort
    /// field — must be non-empty after trim, matching Anki desktop's
    /// "first field can't be empty" rule.
    pub fields: Vec<String>,
    /// Optional whitespace-stripped tags. Empty list is fine.
    #[serde(default)]
    pub tags: Vec<String>,
    /// Optional explicit notetype id. If omitted (or null), the server
    /// resolves the notetype by name = "Basic" — the seeded default on
    /// every fresh collection. Notetype ids are epoch-ms timestamps in
    /// the wild, so a hardcoded numeric default would silently miss
    /// real collections.
    #[serde(default)]
    pub notetype_id: Option<i64>,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct NoteCreateResponse {
    pub note_id: i64,
    /// Number of cards generated from this note's templates. Almost
    /// always ≥ 1 (Basic = 1, Basic+Reverse = 2, Cloze = however many
    /// cloze deletions the front field carries).
    pub card_count: usize,
}

/// Pure validation surface for the request shape. Extracted so the
/// no-Collection rules unit-test cleanly — same `&'static str` extract
/// pattern as Phase 10-C `validate_patch`, 11-A `validate_preset_id`,
/// and 12-B `validate_create_name`.
fn validate_request(req: &NoteCreateRequest) -> Result<(), &'static str> {
    if req.fields.is_empty() {
        return Err("fields must contain at least one entry");
    }
    if req.fields[0].trim().is_empty() {
        return Err("first field must not be empty");
    }
    if req.deck_id <= 0 {
        return Err("deck_id must be a positive integer");
    }
    if let Some(nid) = req.notetype_id {
        if nid <= 0 {
            return Err("notetype_id must be a positive integer when set");
        }
    }
    Ok(())
}

/// Phase 12-C: create a new note + its generated cards.
///
/// Validation order (cheap → expensive, mirroring 11-A):
///   1. Request shape (extracted, no Collection access).
///   2. Notetype lookup (404 — strict, no fallback).
///   3. Field count matches notetype templates (400).
///   4. Deck lookup (404 — strict).
///   5. Filtered-deck rejection (400; filtered decks accept cards via
///      rebuild only, not direct adds).
///   6. `Collection::add_note` — transactional add path that also
///      invokes Anki's card generator.
#[utoipa::path(
    post,
    path = "/api/notes",
    request_body = inline(serde_json::Value),
    responses(
        (status = 200, body = NoteCreateResponse),
        (status = 400, body = crate::error::ApiError),
        (status = 404, body = crate::error::ApiError),
    )
)]
pub async fn post_create(
    state: AppState,
    Json(req): Json<NoteCreateRequest>,
) -> ApiResult<Json<NoteCreateResponse>> {
    validate_request(&req).map_err(ServerError::bad_request)?;

    let mut col = state.col.lock().await;

    // Notetype resolution: explicit id wins; otherwise fall back to the
    // Basic notetype by name. Either path is strict (404 on miss) per
    // the Phase 9-T `bug_caught` lesson — silent fallbacks on missing
    // resources mask client typos.
    let notetype = match req.notetype_id {
        Some(nid) => col
            .get_notetype(NotetypeId(nid))?
            .ok_or_else(|| ServerError::not_found(format!("notetype {nid} not found")))?,
        None => col.get_notetype_by_name("Basic")?.ok_or_else(|| {
            ServerError::not_found(
                "no notetype named 'Basic' on this collection — pass notetype_id explicitly",
            )
        })?,
    };

    if req.fields.len() != notetype.fields.len() {
        return Err(ServerError::bad_request(format!(
            "expected {} fields for notetype {:?}, got {}",
            notetype.fields.len(),
            notetype.name,
            req.fields.len()
        )));
    }

    let did = DeckId(req.deck_id);
    let deck = col
        .get_deck(did)?
        .ok_or_else(|| ServerError::not_found(format!("deck {} not found", req.deck_id)))?;

    if matches!(deck.kind, DeckKind::Filtered(_)) {
        return Err(ServerError::bad_request(
            "cannot add notes directly to a filtered deck",
        ));
    }

    // Build the note. `Note::new` pre-allocates `notetype.fields.len()`
    // empty strings; we replace by index so reordering field input on
    // the client never silently drops a value.
    let mut note = Note::new(&notetype);
    for (i, value) in req.fields.iter().enumerate() {
        note.fields_mut()[i] = value.clone();
    }
    // Tags: trim each + drop blanks so a stray ", " in the input
    // doesn't persist as a "" tag (which would survive query but show
    // weird in the tag pane).
    note.tags = req
        .tags
        .iter()
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
        .collect();

    let card_count = col.add_note(&mut note, did)?.output;

    Ok(Json(NoteCreateResponse {
        note_id: note.id.0,
        card_count,
    }))
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct NoteDeleteResponse {
    /// Number of cards removed alongside the note. `Collection::remove_notes`
    /// returns this from its inner OpOutput; the count varies by notetype
    /// (Basic = 1, Basic+Reverse = 2, Cloze = however many cloze
    /// deletions the front field carried). Useful for an undo toast like
    /// "Deleted note (3 cards)".
    pub removed_card_count: usize,
}

/// Phase 13-A: delete a note (and all of its generated cards) by id.
///
/// Validation order (mirrors the create handler — cheap → expensive):
///   1. id positive (400). Non-positive ids are nonsense as
///      `NoteId` is i64 and the storage path treats them as missing,
///      but we reject at the boundary so the error message is clear.
///   2. Existence via `col.storage.get_note(nid)` (404). The high-level
///      `remove_notes` returns Ok with cards_removed=0 for a missing
///      id rather than erroring, so we must do the existence check
///      ourselves to surface the 404 client behaviour the rest of the
///      path-addressed handlers (cards, decks, deck_config) follow.
///   3. `Collection::remove_notes` — transactional remove path that
///      also drops every card generated from the note's templates.
///
/// The response body's `removed_card_count` is what `OpOutput<usize>`
/// returned — i.e. cards removed, NOT the note count (which is always
/// 1 here).
#[utoipa::path(
    delete,
    path = "/api/notes/{id}",
    responses(
        (status = 200, body = NoteDeleteResponse),
        (status = 400, body = crate::error::ApiError),
        (status = 404, body = crate::error::ApiError),
    ),
    params(("id" = i64, Path, description = "Note id"))
)]
pub async fn delete_by_id(
    state: AppState,
    Path(id): Path<i64>,
) -> ApiResult<Json<NoteDeleteResponse>> {
    validate_delete_id(id).map_err(ServerError::bad_request)?;

    let mut col = state.col.lock().await;
    let nid = NoteId(id);
    // Pre-check via the storage layer so a missing id surfaces as 404
    // instead of a silent zero-card delete. Same strict
    // "path-addressed not-found" pattern as the deck_config / decks
    // handlers (Phase 9-T `bug_caught` lesson).
    if col.storage.get_note(nid)?.is_none() {
        return Err(ServerError::not_found(format!("note {id} not found")));
    }

    // remove_notes returns OpOutput<usize> where the inner usize is the
    // card count, NOT the note count. Surface that directly so a future
    // undo toast can say "Deleted note (3 cards)" without an extra
    // round-trip.
    let removed_card_count = col.remove_notes(&[nid])?.output;

    Ok(Json(NoteDeleteResponse { removed_card_count }))
}

/// Range-validate a delete-by-id request. Same `&'static str` extract
/// pattern as `validate_request` above and the deck_config /
/// decks / cards delete validators. Non-positive ids are rejected so
/// "id 0 not found" can't bleed up as a 404 — it'd be confusing
/// alongside the create handler's deck_id=0 sentinel rule.
fn validate_delete_id(id: i64) -> Result<(), &'static str> {
    if id <= 0 {
        return Err("id must be a positive integer");
    }
    Ok(())
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct NoteSummary {
    pub id: i64,
    /// Owning notetype id (epoch-ms timestamp on real collections).
    pub notetype_id: i64,
    /// Human-readable notetype name (e.g. "Basic", "Cloze"). Lets a
    /// browse editor render field labels per notetype without a
    /// follow-up `/api/notetypes` round-trip.
    pub notetype_name: String,
    /// Raw field values exactly as stored. Phase 16-A intentionally
    /// returns the raw HTML — distinct from the rendered `front_html` /
    /// `back_html` exposed via the browse list endpoints — so editors
    /// can round-trip through PATCH /api/notes/{id} without losing
    /// formatting (the v1 plain-text-only limitation from 14-A).
    pub fields: Vec<String>,
    /// Persisted tags in canonical order (Anki sorts them alphabetically
    /// on add). Same canonical shape as `NotePatchResponse.tags`.
    pub tags: Vec<String>,
    /// Note modified timestamp (epoch seconds). Same field as
    /// `NotePatchResponse.modified` so a successful GET → PATCH cycle
    /// can compare bumps without remembering two field names.
    pub modified: i64,
}

/// Phase 16-A: fetch a note by id with raw field values preserved.
///
/// Mirrors the FFI shape from Phase 15-D `ferdinand_note_get_json` so
/// the web client and the native iOS client can share a single mental
/// model for "the canonical note record". Validation order:
///   1. id positive (400) — same boundary rule as delete / patch.
///   2. Existence via `col.storage.get_note(nid)` (404; same strict
///      lookup as delete to dodge silent-zero sentinels).
///   3. Notetype lookup so the response can carry `notetype_name`.
///      Missing notetype on an existing note is a corruption case —
///      404 with an explicit message rather than 500 because the user-
///      facing client still wants to render an error banner.
///
/// Read-only — no transaction, no mtime bump. Safe to call repeatedly
/// (e.g. from a Svelte `$effect` keyed on `note_id`) without worrying
/// about lock contention with concurrent edits in another client.
#[utoipa::path(
    get,
    path = "/api/notes/{id}",
    responses(
        (status = 200, body = NoteSummary),
        (status = 400, body = crate::error::ApiError),
        (status = 404, body = crate::error::ApiError),
    ),
    params(("id" = i64, Path, description = "Note id"))
)]
pub async fn get_by_id(
    state: AppState,
    Path(id): Path<i64>,
) -> ApiResult<Json<NoteSummary>> {
    if id <= 0 {
        return Err(ServerError::bad_request("id must be a positive integer"));
    }

    let mut col = state.col.lock().await;
    let nid = NoteId(id);
    let note = col
        .storage
        .get_note(nid)?
        .ok_or_else(|| ServerError::not_found(format!("note {id} not found")))?;
    let notetype = col.get_notetype(note.notetype_id)?.ok_or_else(|| {
        ServerError::not_found(format!(
            "notetype {} not found for note {id}",
            note.notetype_id.0
        ))
    })?;

    Ok(Json(NoteSummary {
        id: note.id.0,
        notetype_id: note.notetype_id.0,
        notetype_name: notetype.name.clone(),
        fields: note.fields().clone(),
        tags: note.tags.clone(),
        modified: note.mtime.0,
    }))
}

#[derive(Debug, Default, Deserialize)]
pub struct NotePatchRequest {
    /// New field values in template order. When set, length must match
    /// the underlying notetype's field count exactly (validated post
    /// note lookup). The first field is the sort field — must be
    /// non-empty after trim, mirroring the create handler's rule.
    /// Omit to leave fields untouched.
    #[serde(default)]
    pub fields: Option<Vec<String>>,
    /// New tag list. Trimmed + blank-dropped server-side so a stray
    /// ", " in the input doesn't persist as a "" tag. Omit to leave
    /// tags untouched. Empty array clears all tags (different from
    /// "tags is None").
    #[serde(default)]
    pub tags: Option<Vec<String>>,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct NotePatchResponse {
    pub note_id: i64,
    /// Persisted fields after the patch, in template order. Echoing
    /// these back lets the client refresh its local copy without a
    /// follow-up GET — matches the patch_deck / patch_deck_preset
    /// shape elsewhere in the API.
    pub fields: Vec<String>,
    /// Persisted tags after the patch (already trimmed + blank-dropped).
    pub tags: Vec<String>,
    /// Note modified timestamp (epoch seconds). Useful for an
    /// "updated 5s ago" footer label.
    pub modified: i64,
}

/// Pure-shape validation for a PATCH request. The notetype field-count
/// check needs Collection access, so it stays in the handler — same
/// split as `validate_request` for create. Returning `&'static str`
/// keeps the handler thin and lets unit tests exercise the boundary
/// rules without mocking the Collection.
fn validate_patch(req: &NotePatchRequest) -> Result<(), &'static str> {
    if req.fields.is_none() && req.tags.is_none() {
        return Err("at least one of fields or tags must be set");
    }
    if let Some(fields) = &req.fields {
        if fields.is_empty() {
            return Err("fields must contain at least one entry");
        }
        if fields[0].trim().is_empty() {
            return Err("first field must not be empty");
        }
    }
    Ok(())
}

/// Phase 14-A: partial-update a note's fields and/or tags.
///
/// Validation order (cheap → expensive, mirrors create + delete):
///   1. id positive (400) — same boundary rule as `delete_by_id`.
///   2. Request shape via `validate_patch` (extracted, no Collection).
///   3. Existence via `col.storage.get_note(nid)` (404; same strict
///      lookup as delete to dodge silent-zero sentinels).
///   4. Notetype lookup + field-count match when `fields` is set
///      (404 / 400). The check requires the note's notetype, so it
///      lives post-lookup rather than in `validate_patch`.
///   5. `Collection::update_note` — transactional update path that
///      regenerates field-derived indexes (sort field, search index)
///      and writes the new mtime.
///
/// Tags: when `tags` is set, the supplied list completely replaces
/// the existing tags. Empty array clears all tags; omit the field to
/// leave them untouched.
#[utoipa::path(
    patch,
    path = "/api/notes/{id}",
    request_body = inline(serde_json::Value),
    responses(
        (status = 200, body = NotePatchResponse),
        (status = 400, body = crate::error::ApiError),
        (status = 404, body = crate::error::ApiError),
    ),
    params(("id" = i64, Path, description = "Note id"))
)]
pub async fn patch_by_id(
    state: AppState,
    Path(id): Path<i64>,
    Json(req): Json<NotePatchRequest>,
) -> ApiResult<Json<NotePatchResponse>> {
    if id <= 0 {
        return Err(ServerError::bad_request("id must be a positive integer"));
    }
    validate_patch(&req).map_err(ServerError::bad_request)?;

    let mut col = state.col.lock().await;
    let nid = NoteId(id);

    // Strict existence check first — same path-addressed 404 pattern as
    // the delete handler. Going straight into update_note on a missing
    // id would surface as a generic 500 from the inner storage layer.
    let mut note = col
        .storage
        .get_note(nid)?
        .ok_or_else(|| ServerError::not_found(format!("note {id} not found")))?;

    if let Some(new_fields) = req.fields.as_ref() {
        // Notetype lookup is needed only when fields is present — saves
        // a cache read for tag-only patches.
        let notetype = col.get_notetype(note.notetype_id)?.ok_or_else(|| {
            ServerError::not_found(format!(
                "notetype {} not found for note {id}",
                note.notetype_id.0
            ))
        })?;
        if new_fields.len() != notetype.fields.len() {
            return Err(ServerError::bad_request(format!(
                "expected {} fields for notetype {:?}, got {}",
                notetype.fields.len(),
                notetype.name,
                new_fields.len()
            )));
        }
        // Replace fields by index — mirrors the create handler so a
        // reordered or partial-fill array can never silently drop
        // values.
        for (i, value) in new_fields.iter().enumerate() {
            note.fields_mut()[i] = value.clone();
        }
    }

    if let Some(new_tags) = req.tags.as_ref() {
        // Trim + drop blanks so the persisted list is canonical (same
        // hygiene as create). Empty input list intentionally clears all
        // tags; tags=None leaves them untouched.
        note.tags = new_tags
            .iter()
            .map(|t| t.trim().to_string())
            .filter(|t| !t.is_empty())
            .collect();
    }

    col.update_note(&mut note)?;

    Ok(Json(NotePatchResponse {
        note_id: note.id.0,
        fields: note.fields().clone(),
        tags: note.tags.clone(),
        modified: note.mtime.0,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn req(fields: Vec<&str>) -> NoteCreateRequest {
        NoteCreateRequest {
            deck_id: 1,
            fields: fields.iter().map(|s| s.to_string()).collect(),
            tags: vec![],
            notetype_id: None,
        }
    }

    #[test]
    fn validate_request_rejects_empty_fields_array() {
        let mut r = req(vec![]);
        r.fields = vec![];
        assert_eq!(
            validate_request(&r).unwrap_err(),
            "fields must contain at least one entry"
        );
    }

    #[test]
    fn validate_request_rejects_blank_first_field() {
        for blank in ["", "   ", "\t\n"] {
            let r = req(vec![blank, "back"]);
            assert_eq!(
                validate_request(&r).unwrap_err(),
                "first field must not be empty",
                "blank={blank:?}"
            );
        }
    }

    #[test]
    fn validate_request_accepts_non_empty_first_field_with_blank_back() {
        // Anki desktop only enforces a non-empty FIRST field; subsequent
        // fields can be blank (e.g. cloze cards where the answer is
        // baked into the front field via {{c1::}}).
        let r = req(vec!["forest", ""]);
        assert!(validate_request(&r).is_ok());
    }

    #[test]
    fn validate_request_rejects_non_positive_deck_id() {
        let mut r = req(vec!["forest", "shinrin"]);
        r.deck_id = 0;
        assert_eq!(
            validate_request(&r).unwrap_err(),
            "deck_id must be a positive integer"
        );
        r.deck_id = -1;
        assert!(validate_request(&r).is_err());
    }

    #[test]
    fn validate_request_rejects_non_positive_notetype_id_when_set() {
        let mut r = req(vec!["forest", "shinrin"]);
        r.notetype_id = Some(0);
        assert_eq!(
            validate_request(&r).unwrap_err(),
            "notetype_id must be a positive integer when set"
        );
        r.notetype_id = Some(-1);
        assert!(validate_request(&r).is_err());
    }

    #[test]
    fn validate_request_accepts_notetype_id_omitted() {
        // Default Add-Note flow lets the handler fall back to "Basic"
        // by name; the request shape itself is happy without an id.
        let r = req(vec!["forest", "shinrin"]);
        assert!(r.notetype_id.is_none());
        assert!(validate_request(&r).is_ok());
    }

    #[test]
    fn validate_delete_id_rejects_non_positive() {
        // 0 and negative ids are nonsense — NoteId is i64 but real
        // notes always have positive epoch-ms ids. Reject at the
        // boundary so the user sees "id must be a positive integer"
        // instead of "note 0 not found".
        assert_eq!(
            validate_delete_id(0).unwrap_err(),
            "id must be a positive integer"
        );
        assert_eq!(
            validate_delete_id(-7).unwrap_err(),
            "id must be a positive integer"
        );
    }

    #[test]
    fn validate_delete_id_accepts_epoch_ms_note_ids() {
        // Real note ids are epoch-ms (e.g. notes the Add Note flow
        // creates). The validation cap must accept full i64 range
        // without overflow — same shape as the deck_config /
        // notetype_id checks elsewhere in the codebase.
        assert!(validate_delete_id(1).is_ok());
        assert!(validate_delete_id(1_777_214_900_905).is_ok());
        assert!(validate_delete_id(i64::MAX).is_ok());
    }

    #[test]
    fn validate_patch_rejects_when_neither_fields_nor_tags_set() {
        // Both omitted is meaningless — there's nothing to update. Reject
        // at the boundary so the user sees "at least one of fields or
        // tags must be set" instead of a silent 200 with no work done.
        let r = NotePatchRequest::default();
        assert_eq!(
            validate_patch(&r).unwrap_err(),
            "at least one of fields or tags must be set"
        );
    }

    #[test]
    fn validate_patch_rejects_empty_fields_array() {
        // Distinct from "fields omitted" — supplying [] is an attempt to
        // set fields to nothing, which the notetype length match would
        // catch later, but rejecting here yields a clearer message.
        let r = NotePatchRequest {
            fields: Some(vec![]),
            tags: None,
        };
        assert_eq!(
            validate_patch(&r).unwrap_err(),
            "fields must contain at least one entry"
        );
    }

    #[test]
    fn validate_patch_rejects_blank_first_field() {
        // First field is the sort field — same non-empty-after-trim rule
        // as the create handler. Mirrored across blank flavours so
        // subtle whitespace bugs surface.
        for blank in ["", "   ", "\t\n"] {
            let r = NotePatchRequest {
                fields: Some(vec![blank.to_string(), "back".to_string()]),
                tags: None,
            };
            assert_eq!(
                validate_patch(&r).unwrap_err(),
                "first field must not be empty",
                "blank={blank:?}"
            );
        }
    }

    #[test]
    fn validate_patch_accepts_tags_only_patch() {
        // Tag-only patch is valid even with empty array — empty array is
        // an explicit "clear all tags", different from "tags omitted".
        let r = NotePatchRequest {
            fields: None,
            tags: Some(vec![]),
        };
        assert!(validate_patch(&r).is_ok());

        let r2 = NotePatchRequest {
            fields: None,
            tags: Some(vec!["leech".to_string()]),
        };
        assert!(validate_patch(&r2).is_ok());
    }

    #[test]
    fn validate_patch_accepts_fields_with_blank_back_field() {
        // Same rule as create — only the FIRST field must be non-empty;
        // subsequent fields can be blank (cloze cards bake answers into
        // the front via {{c1::}}).
        let r = NotePatchRequest {
            fields: Some(vec!["forest".to_string(), "".to_string()]),
            tags: None,
        };
        assert!(validate_patch(&r).is_ok());
    }

    // Phase 16-A: NoteSummary shape contract tests. The Collection-touching
    // bits (existence + notetype lookup) are covered by the live curl
    // smoke + browse contract tests; here we pin the JSON shape so a
    // future field rename (e.g. "modified" → "mtime") would surface as a
    // failed snapshot rather than a silent client breakage.

    #[test]
    fn note_summary_serialises_with_six_documented_keys() {
        // Pin the exact key set so the FFI v5 surface (Phase 15-D
        // `ferdinand_note_get_json`) and the new HTTP endpoint stay
        // in lockstep — both produce the same record shape, just with
        // different transports.
        let summary = NoteSummary {
            id: 1_777_215_902_150,
            notetype_id: 1_776_837_237_908,
            notetype_name: "Basic".into(),
            fields: vec!["<b>Front HTML</b>".into(), "Back plain".into()],
            tags: vec!["seed".into(), "ffi".into()],
            modified: 1_777_181_373,
        };
        let v: serde_json::Value =
            serde_json::to_value(&summary).expect("NoteSummary must serialise");
        let obj = v.as_object().expect("NoteSummary serialises to an object");
        let keys: std::collections::HashSet<_> = obj.keys().map(|k| k.as_str()).collect();
        let expected: std::collections::HashSet<_> = [
            "id",
            "notetype_id",
            "notetype_name",
            "fields",
            "tags",
            "modified",
        ]
        .into_iter()
        .collect();
        assert_eq!(
            keys, expected,
            "NoteSummary key set must be exactly the v5 shape"
        );
        assert_eq!(v["id"], 1_777_215_902_150_i64);
        assert_eq!(v["notetype_name"], "Basic");
        // Raw HTML must survive the Serialize round-trip — the whole
        // point of v1 vs the rendered front/back strings the browse
        // list endpoint exposes.
        assert_eq!(v["fields"][0], "<b>Front HTML</b>");
    }

    #[test]
    fn note_summary_round_trip_preserves_cjk_and_empty_arrays() {
        // Covers the two shape edge cases that bit prior phases:
        // (1) tag-less notes serialise tags as `[]`, not `null` —
        //     a Some/None confusion in `NotePatchRequest` once let an
        //     "omitted tags" leak through as `null` and clients had to
        //     special-case the response.
        // (2) CJK round-trips byte-for-byte through serde_json (not as
        //     `\u`-escaped hex).
        let summary = NoteSummary {
            id: 1,
            notetype_id: 1_776_837_237_910,
            notetype_name: "Cloze".into(),
            fields: vec!["{{c1::森林}} = forest".into(), "".into()],
            tags: vec![],
            modified: 1_700_000_000,
        };
        let v = serde_json::to_value(&summary).unwrap();
        assert!(v["tags"].is_array(), "tags must be array even when empty");
        assert_eq!(v["tags"].as_array().unwrap().len(), 0);
        // CJK + cloze deletion markers preserved verbatim.
        assert_eq!(v["fields"][0], "{{c1::森林}} = forest");
        // Blank back field allowed (cloze cards bake answer into front).
        assert_eq!(v["fields"][1], "");
    }

    #[test]
    fn note_summary_modified_is_i64_not_string() {
        // Pin the integer-not-string contract — TypeScript clients that
        // type `modified: number` would silently mis-render an
        // accidentally stringified mtime.
        let summary = NoteSummary {
            id: 1,
            notetype_id: 1,
            notetype_name: "Basic".into(),
            fields: vec!["x".into()],
            tags: vec![],
            modified: 1_777_181_373,
        };
        let v = serde_json::to_value(&summary).unwrap();
        assert!(v["modified"].is_i64());
        assert_eq!(v["modified"].as_i64(), Some(1_777_181_373));
    }

    #[test]
    fn validate_request_accepts_explicit_epoch_ms_notetype_id() {
        // Real notetype ids are epoch-ms (e.g. 1776837237908 on the
        // Ferdinand demo collection). The validation cap must not
        // accidentally exclude these (an `i32` overflow check would).
        let mut r = req(vec!["forest", "shinrin"]);
        r.notetype_id = Some(1_776_837_237_908);
        assert!(validate_request(&r).is_ok());
        r.notetype_id = Some(i64::MAX);
        assert!(validate_request(&r).is_ok());
    }
}
