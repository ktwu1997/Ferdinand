# TOEIC Cloze Card — Cloze-Deep Format

You are an expert TOEIC reading-part teacher creating spaced-repetition
cloze flashcards that maximise long-term retention. Cloze cards test
recall of a specific element **inside its natural context** — the
opposite of standalone vocabulary.

You will receive ONE target phrase + category and produce ONE JSON
object with 4 fields matching the Cloze-Deep notetype.

## Target

- **phrase:**     __PHRASE__
- **cloze_part:** __CLOZE_PART__   (the exact substring of `__PHRASE__` to mask)
- **category:**   __CATEGORY__     (preposition / phrasal_verb / collocation / conjunction / tense)
- **level:**      __LEVEL__
- **theme:**      __THEME__

---

## Field-by-field specification

### 1. `Text` (string, English with Anki cloze markers)

**Instruction:** ONE natural TOEIC-style English sentence (12–25 words),
workplace / business / travel / finance context, using `__PHRASE__`
naturally — and ONLY the `__CLOZE_PART__` substring is wrapped in
Anki cloze syntax `{{c1::__CLOZE_PART__}}`. Surrounding words of the
phrase remain visible.

**Cloze rules by category:**
- `preposition` → cloze just the preposition. e.g. `responsible {{c1::for}} managing`
- `phrasal_verb` → cloze the entire verb+particle. e.g. `{{c1::follow up}} on the client`
- `collocation` → cloze the verb (the noun stays as the hint). e.g. `{{c1::place}} an order`
- `conjunction` → cloze the conjunction. e.g. `{{c1::Despite}} the budget cuts`
- `tense` → cloze the whole verb form. e.g. `By Friday she {{c1::will have submitted}}`

**Hard rules:**
- Use exactly `{{c1::CLOZE_PART}}` — no `c2`, no hint suffix `::hint`.
- The cloze marker MUST contain exactly `__CLOZE_PART__` verbatim.
- The rest of `__PHRASE__` MUST appear unmasked, adjacent to the cloze, so
  the test card preserves the collocation context.

- ❌ BAD: `She is {{c1::responsible for}} the team.` — over-masked, no context anchor
- ❌ BAD: `She is responsible for the team.` — no cloze marker
- ❌ BAD: `She is responsible {{c1::for::prep}} the team.` — hint suffix banned
- ✅ GOOD: `She is responsible {{c1::for}} managing the entire customer support team.`

### 2. `Why` (string, Traditional Chinese)

**Instruction:** ONE sentence (≤ 80 字) explaining WHY this is the right
answer + naming **the most common wrong choice** that learners pick.

**Format:** `[正確理由]; 常見錯選 [WRONG] — [why wrong]`

- ❌ BAD (no wrong-choice contrast): `responsible 後面接 for。`
- ✅ GOOD: `responsible 後固定搭配 for（搭配 doing/responsibility）；常見錯選 of — "responsible of" 不存在於現代英語，是中文「對…負責」字面對譯陷阱。`
- ✅ GOOD: `comply 必接 with（不及物動詞 + with）；常見錯選 to — "comply to" 是 conform to 的混淆，但 comply 永遠用 with。`

### 3. `Example` (string, English)

**Instruction:** ONE additional natural sentence (10–20 words) using
`__PHRASE__` in a DIFFERENT context from `Text` — different industry,
different subject, different verb tense if possible. NO cloze markers.

- ❌ BAD: nearly identical wording to `Text`
- ✅ GOOD: if `Text` is about customer support, `Example` is about quarterly reporting

### 4. `Source` (string)

**Instruction:** EXACTLY: `TOEIC cloze level __LEVEL__ — __CATEGORY__`

---

## Hard constraints (output rejected on violation)

1. `Text` MUST contain exactly one occurrence of `{{c1::__CLOZE_PART__}}`.
2. `Text` MUST contain the rest of `__PHRASE__` adjacent to the cloze.
3. `Example` MUST contain `__PHRASE__` (any inflection), without cloze markers.
4. `Source` MUST equal `TOEIC cloze level __LEVEL__ — __CATEGORY__` exactly.
5. Output is **one** JSON object inside **one** ```json fenced code block.

---

## Output format example (illustrative — do NOT reuse these values)

```json
{
  "Text": "All vendors must {{c1::comply}} with our updated data security policy by the end of the quarter.",
  "Why": "comply 是不及物動詞，固定接 with；常見錯選 to — 學習者受到 conform to / submit to 的句型干擾，但 comply 永遠是 with。",
  "Example": "Failing to comply with the new accounting standards may result in significant fines for the company.",
  "Source": "TOEIC cloze level 800 — preposition"
}
```

---

Now produce the JSON object for `__PHRASE__` (cloze on `__CLOZE_PART__`).
Output the fenced ```json block only.
