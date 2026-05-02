//! Seed `Concept-Deep` + `Cloze-Deep` notetypes — opinionated card
//! formats built around five retention principles: minimum-info,
//! active-recall, contrast-encoding, mnemonic, and source-attribution.
//!
//! Idempotent by exact-name lookup: if either notetype already exists
//! on the collection it is a no-op for that one. Runs unconditionally
//! at server start (unlike `bootstrap::seed_if_requested`, which is
//! gated by `ANKI_SERVER_BOOTSTRAP=1` and seeds *notes*) — adding two
//! empty notetypes is cheap, opt-out is via `FERDINAND_SKIP_NOTETYPE_SEED=1`.
//!
//! Renaming a seeded notetype after first run will cause the seeder
//! to recreate it under the original name on the next start. Users
//! who want to fork the templates should clone first, then rename
//! the clone.

use anki::collection::Collection;
use anki::notetype::{CardTemplate, NoteField, Notetype, NotetypeKind};

pub const CONCEPT_DEEP_NAME: &str = "Concept-Deep";
pub const CLOZE_DEEP_NAME: &str = "Cloze-Deep";

pub const CONCEPT_DEEP_FIELDS: &[&str] = &[
    "Front",
    "Back",
    "Why",
    "Example",
    "Contrast",
    "Mnemonic",
    "Source",
    "ReverseEnabled",
];

pub const CLOZE_DEEP_FIELDS: &[&str] = &["Text", "Why", "Example", "Source"];

/// Inject both notetypes if absent. Honours `FERDINAND_SKIP_NOTETYPE_SEED=1`
/// for users who manage their own notetypes and don't want the autoseed.
pub fn seed_if_missing(col: &mut Collection) -> anyhow::Result<()> {
    if std::env::var("FERDINAND_SKIP_NOTETYPE_SEED").ok().as_deref() == Some("1") {
        tracing::debug!("notetype seed skipped: FERDINAND_SKIP_NOTETYPE_SEED=1");
        return Ok(());
    }
    seed_one(col, CONCEPT_DEEP_NAME, build_concept_deep)?;
    seed_one(col, CLOZE_DEEP_NAME, build_cloze_deep)?;
    Ok(())
}

fn seed_one(
    col: &mut Collection,
    name: &str,
    builder: fn() -> Notetype,
) -> anyhow::Result<()> {
    if col.get_notetype_by_name(name)?.is_some() {
        tracing::debug!(notetype = name, "seed skipped: already present");
        return Ok(());
    }
    let mut nt = builder();
    col.add_notetype(&mut nt, false)?;
    tracing::info!(notetype = name, fields = nt.fields.len(), "notetype seeded");
    Ok(())
}

// ---------- Concept-Deep ----------

fn build_concept_deep() -> Notetype {
    let mut nt = Notetype::default();
    nt.name = CONCEPT_DEEP_NAME.into();
    nt.config.kind = NotetypeKind::Normal as i32;
    nt.config.css = CONCEPT_DEEP_CSS.into();
    for name in CONCEPT_DEEP_FIELDS {
        nt.fields.push(NoteField::new(*name));
    }
    nt.templates
        .push(CardTemplate::new("Forward", forward_qfmt(), forward_afmt()));
    nt.templates.push(CardTemplate::new(
        "Reverse (optional)",
        reverse_qfmt(),
        reverse_afmt(),
    ));
    nt
}

fn forward_qfmt() -> String {
    r#"<div class="front-q">{{Front}}</div>"#.into()
}

fn forward_afmt() -> String {
    [
        r#"{{FrontSide}}"#,
        r#"<hr id=answer>"#,
        r#"<div class="back">{{Back}}</div>"#,
        r#"{{#Why}}<div class="section why"><div class="section-label">Why</div>{{Why}}</div>{{/Why}}"#,
        r#"{{#Example}}<div class="section example"><div class="section-label">Example</div>{{Example}}</div>{{/Example}}"#,
        r#"{{#Contrast}}<div class="section contrast"><div class="section-label">Contrast</div>{{Contrast}}</div>{{/Contrast}}"#,
        r#"{{#Mnemonic}}<div class="section mnemonic"><div class="section-label">Mnemonic</div>{{Mnemonic}}</div>{{/Mnemonic}}"#,
        r#"{{#Source}}<div class="section source">— {{Source}}</div>{{/Source}}"#,
    ]
    .join("\n")
}

/// Mirrors Anki's stock `basic_optional_reverse` pattern: the reverse
/// card is only generated when `ReverseEnabled` is non-empty. The
/// `{{Back}}` reference inside the conditional makes the template
/// valid for `prepare_for_update`'s "card produces from a field" check.
fn reverse_qfmt() -> String {
    r#"{{#ReverseEnabled}}<div class="front-q">{{Back}}</div>{{/ReverseEnabled}}"#.into()
}

fn reverse_afmt() -> String {
    [
        r#"{{FrontSide}}"#,
        r#"<hr id=answer>"#,
        r#"<div class="back">{{Front}}</div>"#,
        r#"{{#Why}}<div class="section why"><div class="section-label">Why</div>{{Why}}</div>{{/Why}}"#,
        r#"{{#Source}}<div class="section source">— {{Source}}</div>{{/Source}}"#,
    ]
    .join("\n")
}

const CONCEPT_DEEP_CSS: &str = r#"
.card {
    font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif;
    font-size: 18px;
    line-height: 1.6;
    color: #1d1d1f;
    background-color: #fafaf7;
    padding: 24px 32px;
    text-align: left;
    max-width: 720px;
    margin: 0 auto;
}
.front-q { font-size: 1.4em; font-weight: 600; }
.back { font-size: 1.1em; }
.section { margin-top: 1.2em; }
.section-label {
    font-size: 0.75em;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #888;
    margin-bottom: 0.25em;
}
.why     { border-left: 3px solid #6b8afd; padding-left: 12px; }
.example pre, .example code {
    background: #f0ede5;
    padding: 8px 12px;
    border-radius: 4px;
    font-family: ui-monospace, "SF Mono", Menlo, monospace;
    font-size: 0.9em;
    overflow-x: auto;
    display: block;
    white-space: pre-wrap;
}
.contrast { color: #b34a2c; font-style: italic; }
.mnemonic { background: #fff8d6; padding: 8px 12px; border-radius: 4px; }
.source   { font-size: 0.8em; color: #999; margin-top: 1.5em; }
hr#answer {
    border: 0;
    border-top: 1px solid #d8d4c7;
    margin: 1em 0;
}
.nightMode .card { color: #e8e6df; background-color: #1f1f1d; }
.nightMode .why { border-left-color: #8aa6ff; }
.nightMode .example pre, .nightMode .example code { background: #2a2a28; }
.nightMode .mnemonic { background: #3a3520; color: #f7e9b3; }
.nightMode .contrast { color: #ff9876; }
.nightMode .source { color: #777; }
"#;

// ---------- Cloze-Deep ----------

fn build_cloze_deep() -> Notetype {
    let mut nt = Notetype::default();
    nt.name = CLOZE_DEEP_NAME.into();
    nt.config.kind = NotetypeKind::Cloze as i32;
    nt.config.css = CLOZE_DEEP_CSS.into();
    for name in CLOZE_DEEP_FIELDS {
        nt.fields.push(NoteField::new(*name));
    }
    nt.templates
        .push(CardTemplate::new("Cloze", cloze_qfmt(), cloze_afmt()));
    nt
}

fn cloze_qfmt() -> String {
    r#"{{cloze:Text}}"#.into()
}

fn cloze_afmt() -> String {
    [
        r#"{{cloze:Text}}"#,
        r#"{{#Why}}<div class="section why"><div class="section-label">Why</div>{{Why}}</div>{{/Why}}"#,
        r#"{{#Example}}<div class="section example"><div class="section-label">Example</div>{{Example}}</div>{{/Example}}"#,
        r#"{{#Source}}<div class="section source">— {{Source}}</div>{{/Source}}"#,
    ]
    .join("\n")
}

const CLOZE_DEEP_CSS: &str = r#"
.card {
    font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif;
    font-size: 18px;
    line-height: 1.6;
    color: #1d1d1f;
    background-color: #fafaf7;
    padding: 24px 32px;
    text-align: left;
    max-width: 720px;
    margin: 0 auto;
}
.cloze {
    font-weight: 600;
    color: #2c5cdc;
    background: #e8efff;
    padding: 0 4px;
    border-radius: 3px;
}
.section { margin-top: 1.2em; }
.section-label {
    font-size: 0.75em;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #888;
    margin-bottom: 0.25em;
}
.why { border-left: 3px solid #6b8afd; padding-left: 12px; }
.example pre, .example code {
    background: #f0ede5;
    padding: 8px 12px;
    border-radius: 4px;
    font-family: ui-monospace, "SF Mono", Menlo, monospace;
    font-size: 0.9em;
    overflow-x: auto;
    display: block;
    white-space: pre-wrap;
}
.source { font-size: 0.8em; color: #999; margin-top: 1.5em; }
.nightMode .card { color: #e8e6df; background-color: #1f1f1d; }
.nightMode .cloze { color: #8eb0ff; background: #1f2d4d; }
.nightMode .example pre, .nightMode .example code { background: #2a2a28; }
"#;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn concept_deep_has_eight_fields_and_two_templates() {
        let nt = build_concept_deep();
        assert_eq!(nt.name, CONCEPT_DEEP_NAME);
        assert_eq!(nt.fields.len(), 8);
        assert_eq!(nt.templates.len(), 2);
        assert_eq!(nt.config.kind, NotetypeKind::Normal as i32);
        let names: Vec<&str> = nt.fields.iter().map(|f| f.name.as_str()).collect();
        assert_eq!(names, CONCEPT_DEEP_FIELDS);
    }

    #[test]
    fn cloze_deep_has_four_fields_and_one_template() {
        let nt = build_cloze_deep();
        assert_eq!(nt.name, CLOZE_DEEP_NAME);
        assert_eq!(nt.fields.len(), 4);
        assert_eq!(nt.templates.len(), 1);
        assert_eq!(nt.config.kind, NotetypeKind::Cloze as i32);
        let names: Vec<&str> = nt.fields.iter().map(|f| f.name.as_str()).collect();
        assert_eq!(names, CLOZE_DEEP_FIELDS);
    }

    #[test]
    fn forward_template_uses_conditional_sections() {
        let afmt = forward_afmt();
        for field in ["Why", "Example", "Contrast", "Mnemonic", "Source"] {
            let open = format!("{{{{#{field}}}}}");
            let close = format!("{{{{/{field}}}}}");
            assert!(afmt.contains(&open), "missing open conditional for {field}");
            assert!(afmt.contains(&close), "missing close conditional for {field}");
        }
        assert!(afmt.contains("{{Back}}"));
        assert!(afmt.contains("{{FrontSide}}"));
    }

    #[test]
    fn reverse_template_is_gated_by_reverse_enabled() {
        let qfmt = reverse_qfmt();
        assert!(qfmt.contains("{{#ReverseEnabled}}"));
        assert!(qfmt.contains("{{/ReverseEnabled}}"));
        assert!(qfmt.contains("{{Back}}"));
    }

    #[test]
    fn cloze_template_uses_cloze_field() {
        assert_eq!(cloze_qfmt(), "{{cloze:Text}}");
        assert!(cloze_afmt().starts_with("{{cloze:Text}}"));
    }
}
