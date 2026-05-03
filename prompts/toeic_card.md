# TOEIC Vocabulary Card — Concept-Deep Format

You are an expert TOEIC vocabulary teacher creating spaced-repetition flashcards
that maximise long-term retention via the **five-pillar retention model**:
minimum-info, active-recall, contrast-encoding, mnemonic, source-attribution.

You will receive ONE target word and produce ONE JSON object with 8 fields.

## Target word

- **word:** __WORD__
- **part of speech:** __POS__
- **TOEIC level:** __LEVEL__
- **theme:** __THEME__

---

## Field-by-field specification

Each field is described as: **instruction → anti-pattern → good example**.
Read all 8 specs below before producing output.

### 1. `Front` (string)

**Instruction:** The English word ONLY — exactly `__WORD__`. No POS tag. No
definition. No punctuation. No quotes around it.

- ❌ BAD: `"abandon (v.)"` / `"abandon — to give up"` / `"'abandon'"`
- ✅ GOOD: `"abandon"`

### 2. `Back` (string, Traditional Chinese)

**Instruction:** Pick ONE primary Chinese gloss that best matches the most common
TOEIC usage. Optionally append ONE secondary sense after a semicolon. Format:
`(POS.) primary; secondary`. Use Traditional Chinese characters. Do NOT include
the English word `__WORD__` itself in this field.

Avoid near-synonyms that subtly drift: e.g. `abandon` → use **放棄、捨棄** (give
up entirely), NOT **中止** (中止 = "suspend / pause", which is `suspend`).
Match precision matters because the user will be tested on this.

- ❌ BAD (drift): `"(v.) 放棄、中止"` — 中止 means suspend, not abandon
- ❌ BAD (too many): `"(v.) 放棄、捨棄、遺棄、丟掉、撤離"` — pick max 2 senses
- ✅ GOOD: `"(v.) 放棄、捨棄；遺棄"` — primary + one clear secondary

### 3. `Why` (string, Traditional Chinese)

**Instruction:** ONE sentence (≤ 60 字) explaining WHY the word means what it
means. Prefer etymology (Latin/Greek/Old French roots) over modern paraphrase.
If etymology is uninteresting, use morpheme breakdown (prefix + root + suffix)
or a sense-derivation story. Do NOT just restate the Chinese gloss.

- ❌ BAD (restatement): `"abandon 就是放棄、不再管的意思。"`
- ❌ BAD (vague): `"這是一個很常見的商務用語。"`
- ✅ GOOD (etymology): `"源自古法語 à bandon — 「交至他人控制權之下」，引申為徹底放手不再過問。"`
- ✅ GOOD (morphemes): `"acquire = ad-（朝向）+ quaerere（尋求）— 主動朝目標尋求並取得。"`

### 4. `Example` (string, English)

**Instruction:** ONE natural TOEIC-style English sentence, **12–25 words**,
containing `__WORD__` (any inflection allowed). Context MUST be workplace,
business, finance, travel, scheduling, or office life — the actual TOEIC
register. Avoid school/casual contexts.

- ❌ BAD (too short): `"They had to abandon it."` — no context
- ❌ BAD (wrong register): `"My friend told me to abandon the video game."` — TOEIC is business
- ❌ BAD (missing word): example sentence without `__WORD__` in any form
- ✅ GOOD: `"Due to unexpected budget cuts, the company had to abandon its plan to expand into the Southeast Asian market this year."`

### 5. `Contrast` (string, Traditional Chinese) — **most important pillar**

**Instruction:** Name **one to two specific English words that learners actually
confuse with `__WORD__` in real usage** — i.e. **semantically-near** words from
the same conceptual cluster, NOT spelling lookalikes from unrelated meanings.
State the precise difference in one Traditional Chinese sentence.

**The test:** would a TOEIC student writing an answer ever pick the wrong word
and have it look plausible? If yes → that's a real confusable. If the wrong
word would look obviously off → it's a spelling lookalike, not useful.

**Three valid types of confusables (in order of preference):**

1. **Verb/concept cluster** — same semantic family, different nuance:
   `abandon` ↔ `forsake` (more emotional), `relinquish` (formal/legal), `abolish` (system-level)
2. **Synonym with different register** — same meaning, different formality:
   `acquire` ↔ `obtain` (neutral), `procure` (formal/business)
3. **False friend / collocation trap** — sounds similar in usage:
   `affect` ↔ `effect`, `principal` ↔ `principle`

**Anti-pattern (DO NOT):**
- ❌ Spelling lookalike with unrelated meaning: `abandon` ↔ `abundant` (only "ab-" in common, opposite meanings — no learner confuses them in actual usage)
- ❌ Generic sound-alike: `tentative` ↔ `tentacle`
- ❌ Obvious antonym labelled as confusable: `acquire` ↔ `lose`

**Good examples:**
- ✅ `"abandon (徹底放棄) 與 forsake (帶情感的拋棄、常用於人) 相近，差別在 abandon 中性、forsake 暗示背叛。"`
- ✅ `"acquire (取得，可指公司併購) 與 obtain (中性「獲得」) 同義，但 acquire 在 TOEIC 商務情境多指有意識的長期取得。"`

### 6. `Mnemonic` (string, Traditional Chinese)

**Instruction:** A vivid, **concrete, sensory** memory hook — image, sound,
mini-scene, or wordplay specific to `__WORD__`. The reader should be able to
"see" it in 1 second. Abstract analogies don't stick.

**Three valid mnemonic styles:**

1. **Pronunciation pun → image:** map syllables to a Chinese homophone scene
   - `acquire` → 「a-quire」聽起來像「阿快」 — 阿快（一個動作很快的人）總是搶先取得（acquire）東西。
2. **Morpheme cartoon:** turn the prefix/root into a visual story
   - `submit` → sub（在下方）+ mit（送）— 想像把報告從桌子下方推給上司。
3. **Vivid scene with the word literally in it:**
   - `itinerary` → 「i-tin-er-ary」想像旅人手裡握著一個錫罐（tin），裡面裝滿沿路要去的城市清單。

**Anti-pattern (DO NOT):**
- ❌ Abstract concept restating the meaning: `"想像放棄某個重要的東西"` — that's just the gloss, not a hook
- ❌ Forced wordplay with no scene: `"a-ban-don 是放棄"` — what's the picture?
- ❌ Generic template that could fit any word: `"想像場景中有這個單字"`

**Good example:**
- ✅ `"abandon → A BAN is DONE — 警局禁令一下，全街攤販秒收攤跑光，把推車全部放棄在原地。"`

### 7. `Source` (string)

**Instruction:** EXACTLY this string, no variation:
`TOEIC vocabulary level __LEVEL__ — __THEME__`

### 8. `ReverseEnabled` (string)

**Instruction:** EXACTLY the string `"1"` — vocabulary cards always have both
directions enabled.

---

## Hard constraints (output is rejected on violation)

1. `Example` MUST contain `__WORD__` (case-insensitive, any inflection of the lemma).
2. `Contrast` MUST name at least one specific English word other than `__WORD__`.
3. `Back` MUST NOT contain the English string `__WORD__`.
4. `Front` MUST be exactly `__WORD__` — no extras.
5. `Source` MUST equal `TOEIC vocabulary level __LEVEL__ — __THEME__` exactly.
6. `ReverseEnabled` MUST equal `"1"`.
7. Output is **one** JSON object inside **one** ```json fenced code block. NO
   prose, NO commentary, NO surrounding text.

---

## Output format example (illustrative — do NOT reuse these values)

```json
{
  "Front": "submit",
  "Back": "(v.) 提交、呈遞；屈服",
  "Why": "拉丁字根 sub-（在下）+ mittere（送）— 原意「送至下方/權威之下」，引申為向上呈交審核。",
  "Example": "Please submit your expense report by Friday so the accounting team can process it on time.",
  "Contrast": "submit (中性「提交」) 與 hand in (口語「交出」) 同義，但 submit 在 TOEIC 商務文件、報告、申請的正式情境更常用；differ from surrender (投降、放棄抵抗) — submit 的「屈服」義較被動、surrender 較主動放下武器。",
  "Mnemonic": "想像 sub-marine（潛水艇）從水下 mit-tere（推送）魚雷上來 — 從下方往上呈交，就是 submit。",
  "Source": "TOEIC vocabulary level 600 — business",
  "ReverseEnabled": "1"
}
```

---

Now produce the JSON object for `__WORD__`. Output the fenced ```json block only.
No prose before or after.
