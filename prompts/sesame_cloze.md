# Sesame Street English Cloze Card — Cloze-Deep Format

You are an expert English vocabulary teacher creating spaced-repetition
**cloze** flashcards that maximise long-term retention. A cloze card
tests recall of a single target word **inside its natural context** — the
learner sees a sentence with the word blanked out and must produce it.

You will receive ONE target word and produce ONE JSON object with 4
fields matching the Cloze-Deep notetype.

## Target

- **word:**       __WORD__
- **phrase:**     __PHRASE__        (the same word — appears in `Example`)
- **cloze_part:** __CLOZE_PART__     (the exact string to mask — equals `__WORD__`)
- **category:**   __CATEGORY__       (part of speech: n / v / adj / adv)
- **level:**      __LEVEL__
- **theme:**      __THEME__

---

## Field-by-field specification

Each field is described as: **instruction → anti-pattern → good example**.
Read all 4 specs before producing output.

### 1. `Text` (string, English with Anki cloze markers)

**Instruction:** ONE natural English sentence, **12–25 words**, in an
everyday / narrative / workplace / nature register — the kind of sentence
a fluent reader would actually encounter. The target word appears **in
the form `__CLOZE_PART__`, positioned mid-sentence (NOT as the first
word)**, so the masked content stays lowercase and matches
`__CLOZE_PART__` verbatim. Wrap exactly that form in Anki cloze syntax:
`{{c1::__CLOZE_PART__}}`.

**Hard rules:**
- Exactly ONE `{{c1::...}}` in `Text`. No `c2`. No `::hint` suffix.
- The cloze content MUST be `__CLOZE_PART__` verbatim — same spelling,
  same case (lowercase). Do not inflect it, do not capitalise it.
- The word must NOT start the sentence (start with another word so the
  cloze content stays lowercase).

- ❌ BAD: `{{c1::Pivotal}} decisions shaped the company.` — sentence-initial, capitalised, won't match `pivotal`
- ❌ BAD: `Her role was {{c1::pivotal}} and {{c1::central}}.` — two cloze markers
- ❌ BAD: `Her role was {{c1::pivotal::adj}} to the project.` — hint suffix banned
- ❌ BAD: `Her role was {{c1::pivoting}} the project.` — inflected, won't match `pivotal`
- ✅ GOOD: `Her quiet support turned out to be {{c1::pivotal}} in helping the team meet an impossible deadline.`

### 2. `Why` (string, Traditional Chinese)

**Instruction:** ONE sentence (≤ 80 字) giving the word's meaning / usage
**plus a memorable hook** — etymology (Latin / Greek / Old French /
Germanic roots), a morpheme breakdown, or a vivid sound / image
association. Do NOT just restate a Chinese gloss. Do NOT use the
"常見錯選 X" wrong-answer framing (that belongs to grammar cloze, not
vocabulary). Same spirit as the `Why` field on the existing Sesame
Concept-Deep cards.

- ❌ BAD (restatement): `pivotal 就是關鍵的、樞紐的意思。`
- ❌ BAD (vague): `這是一個常用來形容重要性的形容詞。`
- ✅ GOOD (etymology): `源自 pivot（樞軸、門軸）— 整扇門靠那根小軸轉動，pivotal 就是「整件事繞著它轉」的關鍵點。`
- ✅ GOOD (morphemes): `facilitate = facil-（容易，源自拉丁 facilis）+ -itate（使之成為）— 把難事變容易，即「促成、便利」。`
- ✅ GOOD (sound image): `stomp 的爆裂音就像鞋跟重重砸地 — 「跺腳、踩踏」帶著怒氣與重量。`

### 3. `Example` (string, English)

**Instruction:** ONE additional natural English sentence, **10–20
words**, using `__PHRASE__` (any inflection allowed) in a context
**different from `Text`** — different scene, subject, register. NO cloze
markers anywhere in this field.

- ❌ BAD: nearly identical wording to `Text`
- ❌ BAD: contains `{{c1::...}}`
- ❌ BAD: example sentence without `__PHRASE__` in any form
- ✅ GOOD: if `Text` is about a work deadline, `Example` is about a documentary or a historical turning point

### 4. `Source` (string)

**Instruction:** EXACTLY: `Sesame Street English — __THEME__`

---

## Hard constraints (output rejected on violation)

1. `Text` MUST contain exactly one occurrence of `{{c1::__CLOZE_PART__}}`,
   with the masked content equal to `__CLOZE_PART__` verbatim (lowercase),
   and the cloze must NOT be at the start of the sentence.
2. `Example` MUST contain `__PHRASE__` (any inflection), without cloze markers.
3. `Source` MUST equal `Sesame Street English — __THEME__` exactly.
4. All four fields are non-empty strings.
5. Output is **one** JSON object inside **one** ```json fenced code block.

---

## Output format example (illustrative — do NOT reuse these values)

```json
{
  "Text": "By the end of the trip, a deep {{c1::tranquility}} had settled over the lakeside cabin where we stayed.",
  "Why": "源自拉丁 tranquillus（風平浪靜）— 海面與心境同樣紋絲不動的安寧狀態，比 calm 更帶「徹底無擾」的層次。",
  "Example": "Meditation each morning brought her a sense of tranquility that lasted through the busiest workdays.",
  "Source": "Sesame Street English — general"
}
```

---

Now produce the JSON object for `__WORD__` (cloze on `__CLOZE_PART__`).
Output the fenced ```json block only.
