# TOEIC Reading-Deep Card — Paragraph Cloze Format

You are an expert TOEIC Part 6 / Part 7 instructor authoring spaced-
repetition reading cards. Reading-Deep cards test **in-context vocabulary
recall plus reading comprehension simultaneously** — the learner must
read a 60–120 word business paragraph (memo / email / announcement /
notice / report) and recall one or two key target words by integrating
the paragraph's full meaning, not just an adjacent collocation.

This is the deeper sibling of Cloze-Deep: Cloze-Deep gives a single
phrase as anchor, Reading-Deep forces the learner to digest a multi-
sentence document.

You will receive ONE seed entry (theme, passage_type, target_words,
context_hint) and produce ONE JSON object with 6 fields matching the
Reading-Deep notetype.

## Target

- **id:**             __ID__
- **theme:**          __THEME__            (business / HR / finance / logistics / travel / legal / IT / marketing)
- **level:**          __LEVEL__            (600 / 700 / 800 / 900)
- **passage_type:**   __PASSAGE_TYPE__     (memo / email / announcement / notice / report)
- **target_words:**   __TARGET_WORDS__     (JSON array of 1–2 single words / short phrases — these become the cloze blanks)
- **context_hint:**   __CONTEXT_HINT__     (one line of scenario seed, e.g. "Q3 audit findings memo to dept heads")

---

## Field-by-field specification

### 1. `Passage` (string, English with Anki cloze markers)

**Instruction:** ONE realistic TOEIC-style business paragraph
(60–120 words, 4–7 sentences) of type `__PASSAGE_TYPE__`, in the theme
`__THEME__`, executing the scenario in `__CONTEXT_HINT__`. Each word in
`__TARGET_WORDS__` must appear EXACTLY ONCE inside the passage and be
wrapped in `{{c1::WORD}}` (first target) and `{{c2::WORD}}` (second
target if present). Surrounding sentences must give enough semantic
context that a careful reader can infer the masked word — but a learner
who only skims one adjacent clause should NOT be able to guess it. The
paragraph must read like a real document, not like a sentence-list.

**Format requirements by passage_type:**
- `memo`         → opens with "TO: ... / FROM: ... / DATE: ... / RE: ..." OR salutation "Dear Team," — body uses 1st-person plural ("we", "our")
- `email`        → opens with "Dear [Name]," or "Hi [Name]," — closes with sign-off; conversational but professional
- `announcement` → opens with header like "Notice: ..." or "**[Topic] Update**" — addresses "all employees" / "all customers"
- `notice`       → posted-document tone, often includes a date / location header, imperative voice ("Please be advised...")
- `report`       → 3rd-person, factual, often opens with summary sentence ("Q3 results indicate...")

**Hard rules:**
- Use exactly `{{c1::WORD}}` for the first target and `{{c2::WORD}}` for the second, in their order of appearance in the passage.
- Each cloze marker MUST contain exactly one of the `__TARGET_WORDS__` verbatim (case-insensitive match against the seed; case in passage may differ for sentence-initial position).
- No `c3` and beyond. No `::hint` suffix.
- Total word count 60–120 inclusive (count after stripping cloze syntax).
- Must be ONE paragraph (no blank lines in the body — header/salutation lines are fine).

- ❌ BAD: target word appears twice in passage (only one is masked, the other leaks the answer)
- ❌ BAD: passage is 3 disconnected sentences with no document framing
- ❌ BAD: `{{c1::process}} the {{c1::request}}` — both targets share `c1`, so a single click reveals both
- ✅ GOOD: 5-sentence inter-department memo where target words sit in different sentences and each is recoverable from paragraph-level context

### 2. `Why` (string, Traditional Chinese)

**Instruction:** ONE concise paragraph (≤ 140 字 total, splittable across
the masked words) explaining WHY each target word is the right pick AND
naming **the most plausible distractor** that would also "kind of fit"
the local clause but fail the full-passage context.

**Format:** `[c1 正確理由 + 段落線索]; 常見錯選 [WRONG] — [why wrong]。 [c2 正確理由 + 段落線索]; 常見錯選 [WRONG] — [why wrong]。`

If only one target, drop the second clause.

- ❌ BAD (no distractor): `implement 表示執行新政策。`
- ✅ GOOD: `c1 implement：段落提到 "rolled out" 與 "next quarter"，是「正式推行新流程」語意；常見錯選 introduce — introduce 只表示「首次提出」，不含「全面落實」的執行力。c2 reimbursed：句中 "submit receipts" 是動賓觸發，表示「核銷退款」；常見錯選 refunded — refund 用於退貨退款，不用於員工費用報銷。`

### 3. `Translation` (string, Traditional Chinese)

**Instruction:** Faithful zh-TW translation of the FULL passage (without
cloze markers — translate as if the words were unmasked). Preserve
document structure: if the passage opens with "TO: ...", translate as
"收件人：..."; if it has a salutation, translate it. Total 60–120 字
target range (Chinese character count). Use 商業書信慣用語 (e.g.
「敬啟者」「謹此通知」when register matches).

- ❌ BAD: machine-literal word-by-word rendering that loses register
- ❌ BAD: includes `{{c1::...}}` markers in the Chinese
- ✅ GOOD: reads like a Chinese memo a Taiwanese 行政 / HR would actually send

### 4. `PassageType` (string)

**Instruction:** EXACTLY one of: `memo` / `email` / `announcement` / `notice` / `report`. Must match `__PASSAGE_TYPE__`.

### 5. `TargetWords` (string)

**Instruction:** The cloze targets joined by `, ` (comma+space) in the
order they appear in the passage. Used by the answer template to render a
quick "the answers were: X, Y" reveal line.

- Example: `implement, reimbursed`
- For a single-target passage: `implement`

### 6. `Source` (string)

**Instruction:** EXACTLY: `TOEIC reading level __LEVEL__ — __PASSAGE_TYPE__ / __THEME__`

---

## Hard constraints (output rejected on violation)

1. `Passage` MUST contain exactly one `{{c1::...}}` cloze.
2. If `__TARGET_WORDS__` has 2 entries, `Passage` MUST also contain exactly one `{{c2::...}}` cloze; if 1 entry, `c2` MUST NOT appear.
3. The content inside each cloze MUST equal the corresponding `__TARGET_WORDS__` entry (case-insensitive).
4. No target word may appear elsewhere in `Passage` outside its cloze (no answer leakage).
5. Word count of `Passage` (after stripping `{{c1::}}` / `{{c2::}}` syntax, keeping the inner words) must satisfy 60 ≤ N ≤ 120.
6. `PassageType` MUST equal `__PASSAGE_TYPE__` exactly.
7. `Source` MUST equal `TOEIC reading level __LEVEL__ — __PASSAGE_TYPE__ / __THEME__`.
8. Output is **one** JSON object inside **one** ```json fenced code block.

---

## Output format example (illustrative — do NOT reuse these values)

```json
{
  "Passage": "TO: All Department Heads\nFROM: Operations Office\nRE: Travel Expense Policy Update\n\nEffective next quarter, we will {{c1::implement}} a revised travel-expense workflow across all regional offices. Employees who submit receipts within fourteen days of return will be {{c2::reimbursed}} via direct deposit by the 15th of the following month. Late submissions remain subject to manager approval. Please share this memo with your teams and direct any questions to the Finance partner assigned to your unit. We appreciate your cooperation as we transition to the new system.",
  "Why": "c1 implement：段落出現 \"rolled out next quarter\" 與 \"new system\" 對應「正式落實新流程」；常見錯選 introduce — introduce 只表示「首次提出」，缺乏「全面執行」的語意。 c2 reimbursed：\"submit receipts\" 與 \"direct deposit\" 是員工費用報銷的固定流程；常見錯選 refunded — refund 用於消費者退款，不用於公司核銷員工差旅費。",
  "Translation": "收件人：各部門主管\n寄件人:營運辦公室\n主旨:差旅費用政策更新\n\n自下一季起，我們將於所有區域辦公室導入新版差旅費用流程。員工返回後十四日內提交收據者，將於次月十五日前以直接匯款方式核銷。逾期提交仍須經主管核准。煩請將本備忘錄轉知所屬團隊；如有任何疑問，請洽財務窗口。感謝各位於系統轉換期間的配合。",
  "PassageType": "memo",
  "TargetWords": "implement, reimbursed",
  "Source": "TOEIC reading level 700 — memo / business"
}
```

---

Now produce the JSON object for id `__ID__` (theme `__THEME__`,
passage_type `__PASSAGE_TYPE__`, targets `__TARGET_WORDS__`,
scenario `__CONTEXT_HINT__`).

Output the fenced ```json block only.
