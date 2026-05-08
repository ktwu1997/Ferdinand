# Handoff: Ferdinand — flashcard app UI redesign

## Overview

Ferdinand is a self-hosted spaced-repetition flashcard app — an Anki successor that drops AnkiWeb sync in favor of a user-controlled server. This handoff covers the **complete v1 visual design system + 9 core screens** (login, dashboard, study, browse, notes/new, stats, settings, deck options, session end) across light/dark themes and desktop/mobile layouts.

## About the Design Files

The files in this bundle are **design references created in HTML** — interactive prototypes showing intended look and behavior. They are **not production code to copy directly**.

The task is to **recreate these HTML designs in the target codebase's environment** (the developer should use the framework chosen for Ferdinand — likely React Native / Swift / Tauri+React, depending on platform) using established patterns. If no codebase exists yet, pick the framework appropriate to the platform target and implement the designs there.

The HTML prototype uses React 18 via Babel-standalone purely for fast iteration on a single page. Production should use a real toolchain.

## Fidelity

**High-fidelity.** All colors, typography, spacing, shadows, and component shapes are final and pixel-precise. Recreate to match. The only intentionally placeholder elements are real card content (Japanese vocabulary samples) and user data (decks, stats numbers).

---

## Visual Identity

### Aesthetic direction

A **kraft-paper / pen-and-notebook** aesthetic. The app should feel like a well-loved paper journal:

- Warm cream paper background (not pure white)
- Deep ink-black text (not pure black)
- A single muted Pine Ink green accent (not vivid)
- Hand-drawn SVG line-art for icons and decoration (1.6px stroke, rounded caps)
- Soft "stamp" shadow on cards: solid offset (e.g. `3px 3px 0 var(--ink)`) — no soft blur
- Subtle paper-grain noise overlay (~3.5% opacity)
- One handwritten font (Caveat) used sparingly for editorial hand-notes; never for UI

### Design tokens

#### Color — light theme (CSS variables, OKLCH for perceptual uniformity)

```css
--bg:        oklch(90.5% 0.022 80);   /* kraft cream — page background */
--bg-soft:   oklch(88%   0.024 80);   /* slightly darker section bg */
--bg-deep:   oklch(85%   0.026 78);   /* deepest, used for hero overlays */
--paper:     oklch(94%   0.018 82);   /* card/panel surface */
--ink:       oklch(22%   0.018 60);   /* primary text + borders */
--ink-soft:  oklch(38%   0.018 60);   /* secondary text */
--ink-mute:  oklch(52%   0.014 60);   /* tertiary / metadata */
--rule:      oklch(72%   0.024 70);   /* dashed dividers */
--rule-soft: oklch(80%   0.022 75);   /* subtle table borders */
--accent:    oklch(34%   0.07  155);  /* Pine Ink green */
--accent-soft: oklch(80% 0.05  150);  /* tinted bg behind accent */
--warn:      oklch(50%   0.13  50);   /* hard / warning */
--due:       oklch(48%   0.13  32);   /* again / danger */
```

#### Color — dark theme

```css
--bg:        oklch(15.5% 0.012 60);
--bg-soft:   oklch(18.5% 0.014 60);
--bg-deep:   oklch(12%   0.01  60);
--paper:     oklch(20%   0.014 62);
--ink:       oklch(92%   0.012 78);
--ink-soft:  oklch(72%   0.012 70);
--ink-mute:  oklch(55%   0.012 70);
--rule:      oklch(34%   0.014 62);
--rule-soft: oklch(26%   0.012 62);
--accent:    oklch(74%   0.10  152);   /* lighter Pine in dark mode */
--accent-soft: oklch(28% 0.05  150);
--warn:      oklch(75%   0.13  60);
--due:       oklch(72%   0.16  30);
```

If your platform doesn't support OKLCH, convert to sRGB hex — but prefer keeping OKLCH, supported in all modern browsers and easy to polyfill.

#### Typography

| Role | Font family | Notes |
|---|---|---|
| **Body / UI sans** | Geist | Loaded via Google Fonts, weights 300–700 |
| **Mono / metadata** | JetBrains Mono | weights 400–700, with `ss02`, `zero`, `cv01` features |
| **CJK content** | `"Klee One", "LXGW WenKai TC", "Noto Serif TC", serif` | Fallback chain handles Japanese kana + most Traditional Chinese; TC-specific characters fall back to LXGW (similar pen feel) |
| **Hand / editorial accent** | Caveat | Used only for "// scribbled" margin annotations |

CSS variable: `--font-cjk: "Klee One", "LXGW WenKai TC", "Noto Serif TC", ui-serif, serif;` — apply this to any field that may contain CJK content (card front/back, deck names, notes).

#### Spacing scale

Most components use `4 / 6 / 8 / 10 / 12 / 14 / 18 / 22 / 28 / 32 / 48` px. There is no formal scale — use these values verbatim. Card padding is typically `20–32px`. Section gaps `22–32px`.

#### Border radius

| Element | Radius |
|---|---|
| Buttons, inputs, chips | `4px` |
| Cards / large panels | `4–6px` |
| Pills / progress bars | `999px` |
| Glyph squares | `3–4px` |
| Tags | `999px` (full pill) |

**Never use rounded corners > 8px.** This aesthetic is rectilinear.

#### Shadow

The signature "stamp" shadow: `Xpx Ypx 0 var(--ink)` where (X, Y) is `(2,2)`, `(3,3)`, `(5,5)`, or `(8,8)` depending on elevation. **No soft blur shadows anywhere.**

#### Borders

`1.2px–1.5px solid var(--ink)` for primary card borders. Dashed `1px var(--rule)` for internal dividers.

---

## Components (atomic)

### Buttons (`<Btn>`)

Five kinds defined in `primitives.jsx`:

- **`primary`** — solid `var(--ink)` bg, `var(--bg)` text, ink stamp shadow
- **`paper`** — `var(--paper)` bg, ink border, ink stamp shadow
- **`outline`** — transparent bg, ink border (used for danger when `borderColor` overridden)
- **`ghost`** — no border, just text + tiny hover bg
- **`accent`** — `var(--accent)` bg (rare; reserved for hero CTAs)

Sizes: `sm` (28px h, 11–12px font), default (36px h, 13–14px font). All button text is lowercase.

Optional `leading` prop renders a sketch icon (12–14px) before the label.

### Captions (`<Caption>`)

Small uppercase mono labels prefixed `// `. The prefix is typed in source — it's intentional aesthetic choice, not a code comment. Examples: `// today`, `// deck.options`, `// answers`.

```css
font-family: "JetBrains Mono", monospace;
font-size: 10–11px;
letter-spacing: 0.16em;
text-transform: uppercase;
color: var(--ink-mute);
```

### Chips / tags

Pill-shaped small labels, `var(--accent-soft)` bg + `var(--accent)` text + `var(--accent)` border:

```css
font-family: "JetBrains Mono", monospace;
font-size: 11px;
padding: 3px 10px;
border: 1px solid var(--accent);
background: var(--accent-soft);
border-radius: 999px;
```

### Sketch icons

All icons are **inline SVG line-art** (no icon font, no Material/Heroicons). 1.6px stroke, rounded caps/joins, rendered in `currentColor`. See `sketches.jsx` for the full library: `SketchPlus`, `SketchBook`, `SketchCardStack`, `SketchCalendar`, `SketchClock`, `SketchUser`, `SketchGlobe`, `SketchLock`, `SketchMail`, `SketchSpark`. The hand-drawn quality is essential — do not substitute polished icon libraries.

### Glyph square

A 22–48px monogram square representing each deck — uppercase 2-letter mono, `var(--accent-soft)` bg, `1.2px solid var(--ink)` border, `2x2` stamp shadow. Always derived from deck name (e.g. `日文 N2 → JP`, `Rust ownership → RS`).

### Toggle, Stepper, RadioRow, RetentionSlider, LearningSteps

Custom form controls, all square-cornered with stamp shadows. Defined in `deck-options.jsx` and `settings.jsx`. Match the visual rhythm of buttons.

### Card / Note (Index card)

The signature element. White paper bg, ink border, stamp shadow. Often shown with a sibling pseudo-element rotated `-0.4deg` behind to suggest a stack of paper:

```jsx
<div style={{ position: "relative" }}>
  <div style={{
    position: "absolute", inset: 0,
    transform: "translate(6px, 6px) rotate(-0.4deg)",
    background: "var(--bg-soft)",
    border: "1.5px solid var(--ink)",
    borderRadius: 6,
  }} />
  <div style={{
    position: "relative",
    background: "var(--paper)",
    border: "1.5px solid var(--ink)",
    borderRadius: 6,
    padding: "32px 36px",
  }}>
    {/* card content */}
  </div>
</div>
```

---

## Screens

### 01 · Login (`login.jsx`)

Split-screen sign-in. Left: hero illustration + product positioning. Right: email/passphrase form, server endpoint field (defaults to `sync.ferdinand.local`), "create account" link.

Mobile collapses to single column with a smaller hero strip.

### 02 · Dashboard (`dashboard.jsx`)

Daily landing page.

- **Top header**: greeting + date + streak chip
- **Today summary card**: due / new / learning counts as 3 large mono numbers, plus a "start session" CTA. Uses sketch art of an open book.
- **Deck list**: rows showing glyph + name + due/new/learning counts + tiny activity sparkline + "study" button. Each row has the stamp-shadow card treatment.
- **Right column** (desktop only): streak heatmap (last 14 days) + retention curve mini.

Mobile: vertical stack, deck rows simplified.

### 03 · Study (`study.jsx`)

The review screen. Front-of-card and answer-revealed states.

- **Top bar**: deck glyph + progress (n / total) + 3-color queue bar (due / learning / new) + timer
- **Center**: index card holding the question. Front shows large CJK term (64–96px). Revealing splits to show reading + meaning + example sentence + extra notes
- **Bottom**: 4 FSRS answer buttons (`again` / `hard` / `good` / `easy`), each labeled with next interval (e.g. `again < 1m`, `good 4d`, `easy 9d`) and `1`/`2`/`3`/`4` hotkey hints

Light + dark + mobile, both states each.

### 04 · Browse (`browse.jsx`)

Card archive / search.

- **Three-pane desktop**: left filters (deck list / state filters / pinned searches / tags), middle table (#, glyph, front, back, deck, tags, due), right preview pane with full FSRS scheduling + metadata + actions
- **Mobile**: search field + state-filter chips + card list + bottom nav

State filters: `all` / `due` / `new` / `learning` / `mature` / `suspended` / `leech`.

### 05 · Notes / new (`notes.jsx`)

Add a new note (= one or more cards from a single source).

- Top selector row: deck dropdown + card type radio (basic / basic+reverse / cloze) + tools (B/I/U/cloze marker)
- Two-column body: form left (front / reading / back / extra / tags), live preview right (full index-card render)
- Save buttons: cancel / save & close / save & add another (⌘↵)

Mobile: single column with mini preview at bottom.

### 06 · Stats (`stats.jsx`)

Statistics dashboard.

- **4 hero numbers**: streak, retention %, reviewed (period), mature card count
- **Reviews-per-day bar chart**: 30 days, two-tone (good vs total), Sunday dip baked into seed
- **Retention curve**: 30 days, 90% target dashed line, mark every 5th point
- **Activity heatmap**: 7×20 grid, 5 levels of accent fill, today highlighted
- **Answer distribution**: 4 horizontal bars (again/hard/good/easy) with counts + percentages
- **Deck breakdown table**: deck / cards / mature / retention / activity sparkline / last-reviewed

Period switcher: `7d / 30d / year / all time`.

### 07 · Settings (`settings.jsx`)

Preferences. Has its own sub-sidebar (general / scheduling / sync / appearance / security / data / experimental). The handoff design shows the **sync tab populated**.

Sync tab fields: status indicator, server endpoint input, account email + passphrase, schedule radio (off / 5m / 15m / 1h / manual), conflict policy, E2E encryption toggles, connected devices list (with revoke), danger zone disconnect.

### 08 · Deck options (`deck-options.jsx`)

Per-deck settings — most-edited screen for power users.

- Mini deck list sidebar (220px) for context
- Preset selector (default / aggressive / fast / custom)
- Daily limits (new/day, max reviews, order, show order)
- FSRS scheduling: **retention slider 70–97%** (90% sweet spot marked), max interval, hard interval, easy bonus
- Learning steps editor: chip timeline `1m → 10m → 1d` with `+ step` affordance
- Display & audio toggles
- Danger zone (empty deck / delete deck)

Plus a **new-deck modal** (520px wide): name, glyph (auto-derived 2 chars), preset, parent, create CTAs.

### 09 · Session end (`session-end.jsx`)

The reward screen when the queue empties.

Three variants:
- **Full**: dual-column with main session card (DONE stamp + retention ring + answer mix + 4 stats) on left, learned-cards list + "remaining today" panel on right, plus a 14-day streak strip below
- **Compact**: full-bleed ceremonial single-card layout with faint background grid of just-reviewed cards (rotated/offset for tactile feel) and a centered hero with 3 key stats
- **Mobile**: hero with stamp + ring + 3 stat rows + answer mix + learned list + streak strip + sticky bottom CTAs

Pick whichever variant matches the platform's culture (Compact for desktop = best ceremony; Full for desktop = denser info; Mobile = mobile).

---

## Interactions & behavior

- **All buttons** lowercase. All metadata in mono. Headings in mono with `-0.02em` letter-spacing.
- **Hotkeys** in study mode: `1/2/3/4` map to again/hard/good/easy; spacebar reveals answer; `e` edits card.
- **Theme switch**: respect system preference by default; provide an override in Settings → Appearance.
- **Streak chip** clickable → opens stats modal (not designed in this round).
- **Sync indicator** in nav rail: green dot when synced, amber when pending, red when failed.
- **Card animation on study answer**: 200ms slide-out left + fade; next card slides in from right. No 3D flips — the card "turns over" by content swap with a 120ms cross-fade.
- **All form changes** in Deck options / Settings should debounce-save (no explicit save button on mobile after the first input change). Header save button on desktop is for the "feel" of commitment.

---

## State management

Per-screen state is local except for these shared concerns:

- **Current deck context** — used by study, browse, deck-options, notes/new
- **Current theme** (`auto / light / dark`) — system-wide
- **Current user / sync session** — auth state
- **Card queue** — populated when starting study; cleared on session end
- **FSRS scheduler instance** — per-deck preset cached

For client-server sync (M4): the protocol contract is `/sync/v1/*` over HTTPS; collection is **end-to-end encrypted client-side** before upload (passphrase derives the key). Server never sees plaintext. Conflict policy is user-configurable (latest-wins / ask / merge).

---

## Files

In `design_handoff_ferdinand/source/`:

| File | Contents |
|---|---|
| `design.html` | Root document — loads fonts, defines CSS tokens, mounts React |
| `app.jsx` | Top-level canvas wiring all sections + theme override tweak |
| `primitives.jsx` | `<Btn>`, `<Caption>`, `<Chip>`, `<KV>`, `<NavRail>` |
| `sketches.jsx` | All hand-drawn SVG icons |
| `login.jsx` | Section 01 |
| `dashboard.jsx` | Section 02 |
| `study.jsx` | Section 03 |
| `browse.jsx` | Section 04 |
| `notes.jsx` | Section 05 |
| `stats.jsx` | Section 06 |
| `settings.jsx` | Section 07 |
| `deck-options.jsx` | Section 08 + new-deck modal |
| `session-end.jsx` | Section 09 |
| `type-options.jsx` | CJK font comparison reference (won't ship — kept for type-decision audit trail) |
| `design-canvas.jsx` | Pan/zoom canvas wrapper used in the prototype only — not part of the product |
| `tweaks-panel.jsx` | Prototype-only theme override panel |

The four prototype-only files (`design-canvas`, `tweaks-panel`, `type-options`, `app`) can be ignored by the implementer — they're scaffolding for the design tool, not the product.

---

## Assets

- **Fonts**: All from Google Fonts (Geist, JetBrains Mono, Caveat, Klee One, LXGW WenKai TC, Noto Serif TC, Zen Kaku Gothic Antique, Zen Maru Gothic, Noto Sans TC). Production should self-host or use a CDN with `font-display: swap`.
- **Icons**: All inline SVG, defined in `sketches.jsx`. No external icon set.
- **Imagery**: None used. Hand-drawn SVG handles all illustrative elements.
- **Logo / app icon**: Not yet designed (next phase).

---

## Open design questions for v2

These were intentionally left for after the core flow:

- Empty states (first-launch, no decks, no due cards, sync failure)
- Onboarding / first-launch tour
- Cloze card editor and image-occlusion editor
- Advanced search syntax UI (`tag:N2 deck:"日文" is:due`)
- App icon, logo, splash screen
- iPad / tablet layout (between mobile and desktop)
- Notifications / streak warnings
- .apkg import flow

The implementer should stub these screens with the cleanest version of the design tokens (a centered Caption + line of mono copy is fine) until they're designed.
