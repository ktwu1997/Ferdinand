/* Study screen — review session
   Layout reuses NavRail from dashboard for consistency.
   Hero is the card itself; below: 4-button FSRS answer row.
   Top strip: deck progress + remaining + timer.
   Front/back states + a "back revealed" variant for completeness.
*/

const { useState: _useStateStudy } = React;

/* Tokens shared with study UI */
const STUDY_INTERVALS = {
  again: "<10m",
  hard:  "1d",
  good:  "5d",
  easy:  "12d",
};

/* Sample card data */
const SAMPLE_CARD = {
  deck: "日文 N2",
  glyph: "JP",
  tags: ["N2", "名詞", "nature"],
  front: "森林",
  reading: "しんりん",
  back: "forest, woods",
  examples: [
    { jp: "森林の中を歩く。", en: "Walk through the forest." },
    { jp: "森林浴は健康にいい。", en: "Forest bathing is good for health." },
  ],
  state: "review",
  ease: 2.5,
  interval: 12,
  reps: 7,
};

/* Top strip — progress + timer + deck */
const StudyHeader = ({ remaining = { n: 6, l: 4, r: 18 }, total = 31, done = 3, elapsed = "04:12" }) => {
  const left = remaining.n + remaining.l + remaining.r;
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "auto 1fr auto",
      alignItems: "center",
      gap: 28,
      padding: "18px 0",
      borderBottom: "1.5px solid var(--ink)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div className="mono" style={{
          width: 36, height: 36, flex: "0 0 36px",
          display: "grid", placeItems: "center",
          border: "1.4px solid var(--ink)", borderRadius: 4,
          background: "var(--paper)", fontSize: 11, fontWeight: 600,
          letterSpacing: "0.04em", lineHeight: 1,
        }}>{SAMPLE_CARD.glyph}</div>
        <div>
          <Caption>// session · 日文 N2</Caption>
          <div className="mono" style={{ fontSize: 13, fontWeight: 500, marginTop: 2 }}>
            card {done + 1} of {total}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Caption>// progress</Caption>
          <span className="mono" style={{ fontSize: 11, color: "var(--ink-mute)" }}>
            <span style={{ color: "var(--due)" }}>{remaining.n} new</span>
            {" · "}
            <span style={{ color: "var(--warn)" }}>{remaining.l} learn</span>
            {" · "}
            <span style={{ color: "var(--accent)" }}>{remaining.r} review</span>
          </span>
        </div>
        <QueueBar n={remaining.n} l={remaining.l} r={remaining.r} total={total} width="100%" />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <SketchClock size={14} />
          <span className="mono" style={{ fontSize: 13 }}>{elapsed}</span>
        </div>
        <Btn kind="ghost" size="sm">end ↵</Btn>
      </div>
    </div>
  );
};

/* The card itself — index-card on a desk feel */
const StudyCard = ({ revealed }) => (
  <div style={{
    position: "relative",
    width: "100%",
    maxWidth: 720,
    margin: "0 auto",
  }}>
    {/* offset shadow card */}
    <div style={{
      position: "absolute", inset: 0, transform: "translate(8px, 8px) rotate(-0.4deg)",
      background: "var(--bg-soft)", border: "1.5px solid var(--ink)", borderRadius: 6,
    }} />
    <div style={{
      position: "relative",
      background: "var(--paper)",
      border: "1.5px solid var(--ink)",
      borderRadius: 6,
      padding: "56px 56px 48px",
      minHeight: 380,
      display: "flex",
      flexDirection: "column",
    }}>
      {/* tag strip */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 32 }}>
        <div style={{ display: "flex", gap: 6 }}>
          {SAMPLE_CARD.tags.map(t => <Chip key={t} color="var(--ink-soft)">{t}</Chip>)}
        </div>
        <Caption>// {SAMPLE_CARD.state} · ease {SAMPLE_CARD.ease} · int {SAMPLE_CARD.interval}d</Caption>
      </div>

      {/* front face */}
      <div style={{ textAlign: "center", marginTop: revealed ? 0 : 28 }}>
        <div style={{
          fontFamily: "var(--font-cjk)",
          fontSize: revealed ? 64 : 96,
          fontWeight: 500,
          lineHeight: 1.1,
          color: "var(--ink)",
          letterSpacing: "0.02em",
          transition: "font-size 220ms ease",
        }}>{SAMPLE_CARD.front}</div>
      </div>

      {/* back face — only when revealed */}
      {revealed && (
        <>
          <div style={{
            margin: "32px auto 0", width: "60%",
            borderTop: "1px dashed var(--rule)",
          }} />
          <div style={{ marginTop: 28, textAlign: "center" }}>
            <div className="mono" style={{
              fontSize: 18, color: "var(--accent)", letterSpacing: "0.04em",
            }}>{SAMPLE_CARD.reading}</div>
            <div style={{
              fontFamily: '"JetBrains Mono", monospace',
              fontSize: 22, fontWeight: 500, marginTop: 10,
              color: "var(--ink)",
            }}>{SAMPLE_CARD.back}</div>
          </div>
          <div style={{ marginTop: 28, padding: "0 32px" }}>
            <Caption style={{ marginBottom: 10 }}>// examples</Caption>
            {SAMPLE_CARD.examples.map((ex, i) => (
              <div key={i} style={{
                padding: "10px 0",
                borderBottom: i === SAMPLE_CARD.examples.length - 1 ? "none" : "1px dashed var(--rule)",
              }}>
                <div style={{ fontFamily: "var(--font-cjk)", fontSize: 17 }}>{ex.jp}</div>
                <div className="mono" style={{ fontSize: 12, color: "var(--ink-mute)", marginTop: 2 }}>{ex.en}</div>
              </div>
            ))}
          </div>
        </>
      )}

      {!revealed && (
        <div style={{ marginTop: "auto", textAlign: "center", paddingTop: 32 }}>
          <span className="mono" style={{ fontSize: 11, letterSpacing: "0.16em", color: "var(--ink-mute)" }}>
            press space · click to flip
          </span>
        </div>
      )}
    </div>
  </div>
);

/* Answer button — 4 across */
const AnswerBtn = ({ kind, label, hotkey, interval, color }) => (
  <button style={{
    display: "flex", flexDirection: "column", alignItems: "stretch",
    gap: 6, padding: "14px 16px",
    border: "1.5px solid var(--ink)",
    borderRadius: 6,
    background: "var(--paper)",
    color: "var(--ink)",
    boxShadow: "3px 3px 0 var(--ink)",
    cursor: "pointer",
    textAlign: "left",
    fontFamily: '"JetBrains Mono", monospace',
  }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <span style={{
        fontSize: 14, fontWeight: 600,
        textTransform: "uppercase", letterSpacing: "0.06em",
        color,
      }}>{label}</span>
      <span style={{
        fontSize: 10, padding: "2px 6px",
        border: "1px solid var(--rule)", borderRadius: 3,
        color: "var(--ink-mute)",
      }}>{hotkey}</span>
    </div>
    <div style={{ fontSize: 11, color: "var(--ink-soft)", letterSpacing: "0.04em" }}>
      next in <span style={{ color }}>{interval}</span>
    </div>
  </button>
);

const AnswerBar = () => (
  <div style={{
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    gap: 14,
    maxWidth: 720,
    margin: "0 auto",
  }}>
    <AnswerBtn kind="again" label="again"  hotkey="1" interval={STUDY_INTERVALS.again} color="var(--again, #b94a3a)" />
    <AnswerBtn kind="hard"  label="hard"   hotkey="2" interval={STUDY_INTERVALS.hard}  color="var(--warn)" />
    <AnswerBtn kind="good"  label="good"   hotkey="3" interval={STUDY_INTERVALS.good}  color="var(--accent)" />
    <AnswerBtn kind="easy"  label="easy"   hotkey="4" interval={STUDY_INTERVALS.easy}  color="var(--easy, #4a6c8e)" />
  </div>
);

const RevealBar = () => (
  <div style={{
    display: "flex", justifyContent: "center", maxWidth: 720, margin: "0 auto",
  }}>
    <Btn kind="primary" size="lg" trailing={<span className="mono" style={{ fontSize: 10, opacity: 0.7, marginLeft: 6 }}>SPACE</span>}>
      show answer
    </Btn>
  </div>
);

/* Main desktop screen */
const StudyV1 = ({ width = 1280, height = 880, revealed = false }) => (
  <div className="theme grain" style={{ width, height, display: "flex", overflow: "hidden" }}>
    <NavRail />
    <main style={{ flex: 1, padding: "32px 56px", display: "flex", flexDirection: "column", gap: 36, overflow: "hidden" }}>
      <StudyHeader />

      <div style={{ flex: 1, display: "flex", alignItems: "center" }}>
        <StudyCard revealed={revealed} />
      </div>

      {revealed ? <AnswerBar /> : <RevealBar />}

      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        borderTop: "1px dashed var(--rule)", paddingTop: 14,
        marginTop: -8,
      }}>
        <Caption>// {SAMPLE_CARD.reps} reviews · added 2025-08-12</Caption>
        <div className="mono" style={{ fontSize: 11, color: "var(--ink-mute)", display: "flex", gap: 16 }}>
          <span>↻ undo</span>
          <span>⇧e edit</span>
          <span>⇧b bury</span>
          <span>⇧s suspend</span>
        </div>
      </div>
    </main>
  </div>
);

/* Mobile */
const StudyMobile = ({ width = 390, height = 844, revealed = false }) => (
  <div className="theme grain" style={{ width, height, position: "relative", overflow: "hidden", display: "flex", flexDirection: "column" }}>
    {/* top bar */}
    <header style={{
      padding: "48px 22px 14px",
      borderBottom: "1.5px solid var(--ink)",
      display: "flex", alignItems: "center", gap: 12,
    }}>
      <Btn kind="ghost" size="sm" style={{ padding: "4px 4px" }}>←</Btn>
      <div style={{ flex: 1 }}>
        <Caption>// 日文 N2</Caption>
        <div className="mono" style={{ fontSize: 12, fontWeight: 500, marginTop: 2 }}>card 4 / 31</div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--ink-soft)" }}>
        <SketchClock size={14} />
        <span className="mono" style={{ fontSize: 12 }}>04:12</span>
      </div>
    </header>

    <div style={{ padding: "10px 22px 0" }}>
      <QueueBar n={6} l={4} r={18} width="100%" />
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
        <span className="mono" style={{ fontSize: 10, color: "var(--due)" }}>6 new</span>
        <span className="mono" style={{ fontSize: 10, color: "var(--warn)" }}>4 learn</span>
        <span className="mono" style={{ fontSize: 10, color: "var(--accent)" }}>18 review</span>
      </div>
    </div>

    <main style={{ flex: 1, padding: "20px 22px", display: "flex", flexDirection: "column", gap: 16, overflow: "auto" }}>
      <div style={{ position: "relative" }}>
        <div style={{
          position: "absolute", inset: 0, transform: "translate(5px, 5px) rotate(-0.5deg)",
          background: "var(--bg-soft)", border: "1.5px solid var(--ink)", borderRadius: 6,
        }} />
        <div style={{
          position: "relative",
          background: "var(--paper)",
          border: "1.5px solid var(--ink)",
          borderRadius: 6,
          padding: "24px 22px 28px",
          minHeight: revealed ? 280 : 320,
          display: "flex", flexDirection: "column",
        }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
            {SAMPLE_CARD.tags.map(t => <Chip key={t} color="var(--ink-soft)">{t}</Chip>)}
          </div>
          <div style={{
            textAlign: "center", marginTop: revealed ? 4 : 24, marginBottom: revealed ? 0 : 16,
            fontFamily: "var(--font-cjk)",
            fontSize: revealed ? 44 : 72, fontWeight: 500, lineHeight: 1.1,
          }}>{SAMPLE_CARD.front}</div>

          {revealed && (
            <>
              <div style={{ width: "50%", margin: "16px auto 14px", borderTop: "1px dashed var(--rule)" }} />
              <div style={{ textAlign: "center" }}>
                <div className="mono" style={{ color: "var(--accent)", fontSize: 14 }}>{SAMPLE_CARD.reading}</div>
                <div className="mono" style={{ fontSize: 16, marginTop: 6 }}>{SAMPLE_CARD.back}</div>
              </div>
              <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px dashed var(--rule)" }}>
                {SAMPLE_CARD.examples.slice(0,1).map((ex, i) => (
                  <div key={i}>
                    <div style={{ fontFamily: "var(--font-cjk)", fontSize: 14 }}>{ex.jp}</div>
                    <div className="mono" style={{ fontSize: 11, color: "var(--ink-mute)" }}>{ex.en}</div>
                  </div>
                ))}
              </div>
            </>
          )}
          {!revealed && (
            <div style={{ marginTop: "auto", textAlign: "center", paddingTop: 16 }}>
              <span className="mono" style={{ fontSize: 10, letterSpacing: "0.14em", color: "var(--ink-mute)" }}>
                tap to flip
              </span>
            </div>
          )}
        </div>
      </div>
    </main>

    <div style={{ padding: "12px 22px 26px", borderTop: "1.5px solid var(--ink)", background: "var(--bg-soft)" }}>
      {revealed ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
          {[
            { l: "again", c: "var(--due)", i: STUDY_INTERVALS.again },
            { l: "hard",  c: "var(--warn)", i: STUDY_INTERVALS.hard },
            { l: "good",  c: "var(--accent)", i: STUDY_INTERVALS.good },
            { l: "easy",  c: "var(--easy,#4a6c8e)", i: STUDY_INTERVALS.easy },
          ].map(b => (
            <button key={b.l} style={{
              border: "1.4px solid var(--ink)", borderRadius: 6,
              background: "var(--paper)", padding: "8px 4px",
              display: "flex", flexDirection: "column", gap: 2,
              fontFamily: '"JetBrains Mono", monospace',
              boxShadow: "2px 2px 0 var(--ink)",
            }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: b.c, textTransform: "uppercase" }}>{b.l}</span>
              <span style={{ fontSize: 9, color: "var(--ink-mute)" }}>{b.i}</span>
            </button>
          ))}
        </div>
      ) : (
        <Btn kind="primary" size="lg" style={{ width: "100%", justifyContent: "center" }}>
          show answer
        </Btn>
      )}
    </div>
  </div>
);

Object.assign(window, { StudyV1, StudyMobile });
