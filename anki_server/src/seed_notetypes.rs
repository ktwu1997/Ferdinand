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

/// Notetype CSS pulls from mockup design tokens (mockup/src/lib/tokens.css)
/// so cards inherit theme colours from the host page. Falls back to literal
/// oklch values for renderers that don't expose the parent stylesheet.
/// No coloured section backgrounds — sections are differentiated by label
/// typography + spacing only, matching Notion/Linear flat-doc aesthetic.
const CONCEPT_DEEP_CSS: &str = r#"
.card {
    font-family: var(--font-sans, "Inter", "Noto Sans TC", "PingFang TC", system-ui, sans-serif);
    font-size: var(--text-base, 1rem);
    line-height: 1.7;
    color: var(--text, oklch(22% 0.012 60));
    background: transparent;
    padding: var(--space-8, 2rem) var(--space-6, 1.5rem);
    text-align: left;
    max-width: var(--content-max, 720px);
    margin: 0 auto;
}
.front-q {
    font-size: var(--text-2xl, 1.5rem);
    font-weight: 600;
    color: var(--text, oklch(22% 0.012 60));
}
.back {
    font-size: var(--text-lg, 1.125rem);
    font-weight: 500;
    color: var(--text, oklch(22% 0.012 60));
    margin-top: var(--space-2, 0.5rem);
}
.section {
    margin-top: var(--space-6, 1.5rem);
}
.section-label {
    font-size: var(--text-xs, 0.75rem);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-subtle, oklch(65% 0.006 60));
    margin-bottom: var(--space-1, 0.25rem);
}
.section > :not(.section-label) {
    color: var(--text-muted, oklch(50% 0.008 60));
}
.example pre, .example code {
    font-family: var(--font-mono, ui-monospace, "JetBrains Mono", Menlo, monospace);
    font-size: var(--text-sm, 0.875rem);
}
.source {
    margin-top: var(--space-8, 2rem);
    padding-top: var(--space-3, 0.75rem);
    border-top: 1px solid var(--border, oklch(88% 0.015 80));
    font-size: var(--text-xs, 0.75rem);
    color: var(--text-subtle, oklch(65% 0.006 60));
}
hr#answer {
    border: 0;
    border-top: 1px solid var(--border, oklch(88% 0.015 80));
    margin: var(--space-5, 1.25rem) 0;
}
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
    font-family: var(--font-sans, "Inter", "Noto Sans TC", "PingFang TC", system-ui, sans-serif);
    font-size: var(--text-base, 1rem);
    line-height: 1.7;
    color: var(--text, oklch(22% 0.012 60));
    background: transparent;
    padding: var(--space-8, 2rem) var(--space-6, 1.5rem);
    text-align: left;
    max-width: var(--content-max, 720px);
    margin: 0 auto;
}
.cloze {
    font-weight: 600;
    color: var(--accent, oklch(50% 0.13 40));
}
.section {
    margin-top: var(--space-6, 1.5rem);
}
.section-label {
    font-size: var(--text-xs, 0.75rem);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-subtle, oklch(65% 0.006 60));
    margin-bottom: var(--space-1, 0.25rem);
}
.section > :not(.section-label) {
    color: var(--text-muted, oklch(50% 0.008 60));
}
.example pre, .example code {
    font-family: var(--font-mono, ui-monospace, "JetBrains Mono", Menlo, monospace);
    font-size: var(--text-sm, 0.875rem);
}
.source {
    margin-top: var(--space-8, 2rem);
    padding-top: var(--space-3, 0.75rem);
    border-top: 1px solid var(--border, oklch(88% 0.015 80));
    font-size: var(--text-xs, 0.75rem);
    color: var(--text-subtle, oklch(65% 0.006 60));
}
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
