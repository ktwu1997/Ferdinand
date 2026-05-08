/* Notes / new — add a new note (card)
   Two-pane: form on left, live preview on right.
   Top: deck selector + card type. Tags below the text fields.
*/

const NoteFieldLabel = ({ children, hint }) => (
  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
    <Caption>// {children}</Caption>
    {hint && <span className="mono" style={{ fontSize: 10, color: "var(--ink-mute)" }}>{hint}</span>}
  </div>
);

const NoteTextarea = ({ value, placeholder, minH = 120, mono = false, serif = false, fontSize = 14 }) => (
  <div style={{
    border: "1.5px solid var(--ink)", borderRadius: 4,
    background: "var(--paper)",
    padding: "12px 14px",
    minHeight: minH,
    boxShadow: "2px 2px 0 var(--ink)",
    fontFamily: serif ? "var(--font-cjk)"
              : mono ? '"JetBrains Mono", monospace'
              : '"Geist", sans-serif',
    fontSize,
    color: value ? "var(--ink)" : "var(--ink-mute)",
    whiteSpace: "pre-wrap",
    lineHeight: 1.5,
  }}>{value || placeholder}</div>
);

const NotesV1 = ({ width = 1280, height = 880 }) => (
  <div className="theme grain" style={{ width, height, display: "flex", overflow: "hidden" }}>
    <NavRail />
    <main style={{ flex: 1, padding: "32px 48px", display: "flex", flexDirection: "column", gap: 22, overflow: "auto" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <Caption>// the.workshop</Caption>
          <h1 style={{
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: 28, fontWeight: 600, margin: "6px 0 0", letterSpacing: "-0.02em",
          }}>new note
            <span className="hand" style={{ color: "var(--accent)", fontSize: 22, marginLeft: 12 }}>
              add to library
            </span>
          </h1>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Btn kind="ghost" size="sm">cancel</Btn>
          <Btn kind="paper" size="sm">save & close</Btn>
          <Btn kind="primary" size="sm" leading={<SketchPlus size={12} />}>save & add another <span className="mono" style={{ fontSize: 10, opacity: 0.7, marginLeft: 6 }}>⌘↵</span></Btn>
        </div>
      </header>

      {/* deck + type selectors */}
      <div style={{
        display: "grid", gridTemplateColumns: "1fr 1fr auto",
        gap: 12,
        padding: "14px 16px",
        background: "var(--bg-soft)",
        border: "1.5px solid var(--ink)", borderRadius: 4,
      }}>
        <div>
          <Caption>// deck</Caption>
          <div style={{
            marginTop: 4, display: "flex", alignItems: "center", gap: 10,
            padding: "8px 12px", background: "var(--paper)",
            border: "1.2px solid var(--ink)", borderRadius: 4,
            fontFamily: '"JetBrains Mono", monospace', fontSize: 13,
          }}>
            <span style={{
              width: 22, height: 22, display: "grid", placeItems: "center",
              border: "1px solid var(--ink)", borderRadius: 3, fontSize: 9, fontWeight: 600,
              background: "var(--accent-soft)",
            }}>JP</span>
            <span>日文 N2</span>
            <span style={{ marginLeft: "auto", color: "var(--ink-mute)", fontSize: 11 }}>2,340 cards</span>
            <span style={{ color: "var(--ink-mute)" }}>▾</span>
          </div>
        </div>
        <div>
          <Caption>// type</Caption>
          <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
            {["basic", "basic + reverse", "cloze"].map((t, i) => (
              <span key={t} className="mono" style={{
                fontSize: 11, padding: "7px 12px",
                border: "1.2px solid var(--ink)", borderRadius: 4,
                background: i === 0 ? "var(--ink)" : "var(--paper)",
                color: i === 0 ? "var(--bg)" : "var(--ink-soft)",
                letterSpacing: "0.06em",
                cursor: "pointer",
              }}>{t}</span>
            ))}
          </div>
        </div>
        <div>
          <Caption>// tools</Caption>
          <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
            {["B", "I", "U", "·", "<>", "🖼"].map((g, i) => (
              <span key={i} className="mono" style={{
                width: 28, height: 28, display: "grid", placeItems: "center",
                border: "1.2px solid var(--ink)", borderRadius: 3,
                background: "var(--paper)", fontSize: 11, fontWeight: 600,
                color: "var(--ink-soft)",
              }}>{g}</span>
            ))}
          </div>
        </div>
      </div>

      {/* form + preview */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 28, flex: 1, minHeight: 0 }}>
        {/* form */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <NoteFieldLabel hint="kanji · vocabulary · concept">front</NoteFieldLabel>
            <NoteTextarea value={"懐かしい"} minH={88} serif fontSize={28} />
          </div>
          <div>
            <NoteFieldLabel hint="reading">reading</NoteFieldLabel>
            <NoteTextarea value={"なつかしい"} minH={48} mono fontSize={16} />
          </div>
          <div>
            <NoteFieldLabel hint="meaning · definition">back</NoteFieldLabel>
            <NoteTextarea value={"nostalgic, dear, fondly remembered\n— often used for things from one's past that evoke warmth"} minH={120} fontSize={14} />
          </div>
          <div>
            <NoteFieldLabel hint="optional · examples · mnemonics">extra</NoteFieldLabel>
            <NoteTextarea value={"昔の写真を見ると懐かしい気持ちになる。\n— Looking at old photos brings a nostalgic feeling."} minH={92} serif fontSize={13} />
          </div>
          <div>
            <NoteFieldLabel hint="press enter to add">tags</NoteFieldLabel>
            <div style={{
              display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center",
              padding: "10px 12px",
              border: "1.5px solid var(--ink)", borderRadius: 4,
              background: "var(--paper)",
              boxShadow: "2px 2px 0 var(--ink)",
            }}>
              {["N2", "形容詞", "emotion"].map(t => (
                <span key={t} className="mono" style={{
                  fontSize: 11, padding: "3px 10px",
                  border: "1px solid var(--accent)", color: "var(--accent)",
                  background: "var(--accent-soft)", borderRadius: 999,
                  display: "flex", alignItems: "center", gap: 6,
                }}>
                  {t} <span style={{ color: "var(--ink-mute)" }}>×</span>
                </span>
              ))}
              <span className="mono" style={{ fontSize: 11, color: "var(--ink-mute)" }}>+ add tag…</span>
            </div>
          </div>
        </div>

        {/* preview */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Caption>// preview · live</Caption>
            <div style={{ display: "flex", gap: 6 }}>
              {["front", "back"].map((s, i) => (
                <span key={s} className="mono" style={{
                  fontSize: 10, padding: "3px 10px",
                  border: "1.2px solid var(--ink)", borderRadius: 999,
                  background: i === 1 ? "var(--ink)" : "var(--paper)",
                  color: i === 1 ? "var(--bg)" : "var(--ink-soft)",
                  letterSpacing: "0.08em", textTransform: "uppercase",
                }}>{s}</span>
              ))}
            </div>
          </div>

          <div style={{ position: "relative", flex: 1 }}>
            <div style={{
              position: "absolute", inset: 0, transform: "translate(6px, 6px) rotate(-0.4deg)",
              background: "var(--bg-soft)", border: "1.5px solid var(--ink)", borderRadius: 6,
            }} />
            <div style={{
              position: "relative", height: "100%",
              background: "var(--paper)", border: "1.5px solid var(--ink)",
              borderRadius: 6, padding: "32px 36px",
              display: "flex", flexDirection: "column",
            }}>
              <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
                {["N2","形容詞","emotion"].map(t => <Chip key={t}>{t}</Chip>)}
              </div>
              <div style={{
                fontFamily: "var(--font-cjk)",
                fontSize: 56, fontWeight: 500, textAlign: "center", lineHeight: 1.1,
              }}>懐かしい</div>
              <div style={{ width: "55%", margin: "20px auto 18px", borderTop: "1px dashed var(--rule)" }} />
              <div className="mono" style={{ color: "var(--accent)", fontSize: 16, textAlign: "center" }}>なつかしい</div>
              <div style={{ fontSize: 16, textAlign: "center", marginTop: 8, lineHeight: 1.55 }}>
                nostalgic, dear, fondly remembered
              </div>
              <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px dashed var(--rule)" }}>
                <Caption style={{ marginBottom: 8 }}>// extra</Caption>
                <div style={{ fontFamily: "var(--font-cjk)", fontSize: 14 }}>
                  昔の写真を見ると懐かしい気持ちになる。
                </div>
                <div className="mono" style={{ fontSize: 11, color: "var(--ink-mute)", marginTop: 4 }}>
                  Looking at old photos brings a nostalgic feeling.
                </div>
              </div>

              <div style={{
                marginTop: "auto", paddingTop: 14,
                display: "flex", justifyContent: "space-between",
                fontFamily: '"JetBrains Mono", monospace', fontSize: 10, color: "var(--ink-mute)",
                letterSpacing: "0.08em",
              }}>
                <span>· will be queued as new</span>
                <span>· first review: today</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  </div>
);

const NotesMobile = ({ width = 390, height = 844 }) => (
  <div className="theme grain" style={{ width, height, position: "relative", overflow: "hidden", display: "flex", flexDirection: "column" }}>
    <header style={{
      padding: "48px 22px 14px",
      borderBottom: "1.5px solid var(--ink)",
      display: "flex", justifyContent: "space-between", alignItems: "center",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Btn kind="ghost" size="sm" style={{ padding: "4px 4px" }}>×</Btn>
        <div>
          <Caption>// new note</Caption>
          <div className="mono" style={{ fontSize: 13, fontWeight: 500, marginTop: 1 }}>日文 N2 · basic</div>
        </div>
      </div>
      <Btn kind="primary" size="sm">save</Btn>
    </header>

    <main style={{ flex: 1, overflow: "auto", padding: "16px 22px 24px", display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <NoteFieldLabel>front</NoteFieldLabel>
        <NoteTextarea value={"懐かしい"} minH={72} serif fontSize={26} />
      </div>
      <div>
        <NoteFieldLabel>reading</NoteFieldLabel>
        <NoteTextarea value={"なつかしい"} minH={44} mono fontSize={14} />
      </div>
      <div>
        <NoteFieldLabel>back</NoteFieldLabel>
        <NoteTextarea value={"nostalgic, dear, fondly remembered"} minH={84} fontSize={13} />
      </div>
      <div>
        <NoteFieldLabel>tags</NoteFieldLabel>
        <div style={{
          display: "flex", flexWrap: "wrap", gap: 5,
          padding: "10px 12px",
          border: "1.4px solid var(--ink)", borderRadius: 4,
          background: "var(--paper)",
          boxShadow: "2px 2px 0 var(--ink)",
        }}>
          {["N2", "形容詞"].map(t => (
            <span key={t} className="mono" style={{
              fontSize: 10, padding: "2px 8px",
              border: "1px solid var(--accent)", color: "var(--accent)",
              background: "var(--accent-soft)", borderRadius: 999,
            }}>{t} ×</span>
          ))}
          <span className="mono" style={{ fontSize: 10, color: "var(--ink-mute)" }}>+ tag</span>
        </div>
      </div>

      <div style={{ marginTop: 4 }}>
        <Caption style={{ marginBottom: 8 }}>// preview</Caption>
        <div style={{
          background: "var(--paper)", border: "1.4px solid var(--ink)",
          borderRadius: 6, padding: "18px 20px",
          boxShadow: "3px 3px 0 var(--ink)",
        }}>
          <div style={{ fontFamily: "var(--font-cjk)", fontSize: 36, fontWeight: 500, textAlign: "center" }}>懐かしい</div>
          <div style={{ width: "50%", margin: "12px auto", borderTop: "1px dashed var(--rule)" }} />
          <div className="mono" style={{ color: "var(--accent)", fontSize: 13, textAlign: "center" }}>なつかしい</div>
          <div className="mono" style={{ fontSize: 13, textAlign: "center", marginTop: 4 }}>nostalgic, dear, fondly remembered</div>
        </div>
      </div>
    </main>
  </div>
);

Object.assign(window, { NotesV1, NotesMobile });
