/* Browse screen — card library
   Three-pane: left = saved searches + tag tree
              center = card list/table with search + filters
              right = card preview/detail (collapsible)
*/

const { useState: _useStateBrowse } = React;

const BROWSE_CARDS = [
  { id: "c1",  glyph: "JP", front: "森林", reading: "しんりん", back: "forest, woods", deck: "日文 N2", tags: ["N2", "名詞", "nature"], due: "now", state: "review", interval: 12, ease: 2.5 },
  { id: "c2",  glyph: "JP", front: "海", reading: "うみ", back: "sea, ocean", deck: "日文 N2", tags: ["N2", "名詞"], due: "5d", state: "review", interval: 45, ease: 2.6 },
  { id: "c3",  glyph: "JP", front: "山", reading: "やま", back: "mountain", deck: "日文 N2", tags: ["N2", "名詞"], due: "12d", state: "review", interval: 60, ease: 2.7 },
  { id: "c4",  glyph: "JP", front: "懐かしい", reading: "なつかしい", back: "nostalgic, dear", deck: "日文 N2", tags: ["N2", "形容詞"], due: "2d", state: "learning", interval: 1, ease: 2.3 },
  { id: "c5",  glyph: "RS", front: "What is a borrow checker error?", back: "Cannot borrow `s` mutable while immutable…", deck: "Rust ownership", tags: ["ownership", "borrow"], due: "now", state: "review", interval: 8, ease: 2.4 },
  { id: "c6",  glyph: "RS", front: "Difference between Copy and Clone?", back: "Copy: implicit bitwise; Clone: explicit, can alloc.", deck: "Rust ownership", tags: ["traits"], due: "3d", state: "review", interval: 14, ease: 2.5 },
  { id: "c7",  glyph: "HX", front: "Date of fall of Constantinople", back: "1453, 29 May.", deck: "World History", tags: ["byzantine", "ottoman"], due: "now", state: "review", interval: 25, ease: 2.6 },
  { id: "c8",  glyph: "AN", front: "Cranial nerve for tongue?", back: "Hypoglossal (CN XII).", deck: "Anatomy", tags: ["neuroanatomy"], due: "1d", state: "review", interval: 6, ease: 2.4 },
  { id: "c9",  glyph: "JP", front: "桜", reading: "さくら", back: "cherry blossom", deck: "日文 N2", tags: ["N2", "名詞", "nature"], due: "8d", state: "review", interval: 32, ease: 2.5 },
  { id: "c10", glyph: "RS", front: "What does `?` operator do?", back: "Early-return Result/Option err.", deck: "Rust ownership", tags: ["syntax"], due: "now", state: "learning", interval: 1, ease: 2.0 },
];

const BrowseSidebar = () => (
  <aside style={{
    width: 240,
    background: "var(--bg-soft)",
    borderRight: "1.5px solid var(--ink)",
    padding: "24px 18px 24px 22px",
    overflow: "auto",
    flexShrink: 0,
    display: "flex", flexDirection: "column", gap: 22,
  }}>
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <FerdinandMark size={24} />
      <div className="mono" style={{ fontSize: 13, fontWeight: 600 }}>Ferdinand</div>
    </div>

    <div>
      <Caption style={{ marginBottom: 10 }}>// decks</Caption>
      {[
        { name: "all decks", count: 5412, on: true },
        { name: "日文 N2", count: 2340 },
        { name: "Rust ownership", count: 412 },
        { name: "World History", count: 890 },
        { name: "Anatomy", count: 1567 },
        { name: "Piano theory", count: 203 },
      ].map(d => (
        <div key={d.name} style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "5px 8px", borderRadius: 4,
          background: d.on ? "var(--paper)" : "transparent",
          border: d.on ? "1.2px solid var(--ink)" : "1.2px solid transparent",
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: 12, color: d.on ? "var(--ink)" : "var(--ink-soft)",
          marginBottom: 2,
          cursor: "pointer",
        }}>
          <span>{d.name}</span>
          <span style={{ fontSize: 10, color: "var(--ink-mute)" }}>{d.count}</span>
        </div>
      ))}
    </div>

    <div>
      <Caption style={{ marginBottom: 10 }}>// state</Caption>
      {[
        { l: "new", c: 22, color: "var(--due)" },
        { l: "learning", c: 10, color: "var(--warn)" },
        { l: "review", c: 64, color: "var(--accent)" },
        { l: "suspended", c: 3, color: "var(--ink-mute)" },
      ].map(s => (
        <div key={s.l} style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "4px 8px",
          fontFamily: '"JetBrains Mono", monospace', fontSize: 12,
          color: "var(--ink-soft)",
        }}>
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color, border: "1px solid var(--ink)" }} />
            {s.l}
          </span>
          <span style={{ fontSize: 10, color: "var(--ink-mute)" }}>{s.c}</span>
        </div>
      ))}
    </div>

    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <Caption>// pinned searches</Caption>
        <SketchPlus size={12} style={{ color: "var(--ink-mute)" }} />
      </div>
      {[
        { name: "leeches", q: "tag:leech" },
        { name: "added today", q: "added:1" },
        { name: "hard rust", q: 'rated:1:1' },
      ].map(s => (
        <div key={s.name} style={{
          padding: "5px 8px",
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: 12, color: "var(--ink-soft)",
          marginBottom: 2,
          cursor: "pointer",
        }}>
          <div>· {s.name}</div>
          <div style={{ fontSize: 10, color: "var(--ink-mute)", marginLeft: 10 }}>{s.q}</div>
        </div>
      ))}
    </div>

    <div>
      <Caption style={{ marginBottom: 10 }}>// tags</Caption>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {["N2", "名詞", "形容詞", "nature", "ownership", "borrow", "traits", "byzantine", "ottoman", "neuroanatomy"].map(t => (
          <span key={t} className="mono" style={{
            fontSize: 10, padding: "2px 8px",
            border: "1px solid var(--rule-soft)", borderRadius: 999,
            color: "var(--ink-soft)", background: "var(--paper)",
            cursor: "pointer",
          }}>{t}</span>
        ))}
      </div>
    </div>

    <div style={{ marginTop: "auto", borderTop: "1px dashed var(--rule)", paddingTop: 12 }}>
      <Btn kind="ghost" size="sm" leading={<SketchBook size={14} />}>back to decks</Btn>
    </div>
  </aside>
);

const BrowseRow = ({ c, idx, selected, dim }) => (
  <div style={{
    display: "grid",
    gridTemplateColumns: "auto auto 1.6fr 1.4fr 80px 90px 70px",
    gap: 14,
    alignItems: "center",
    padding: "10px 12px",
    borderBottom: "1px solid var(--rule-soft)",
    background: selected ? "var(--paper)" : "transparent",
    border: selected ? "1.2px solid var(--ink)" : undefined,
    borderRadius: selected ? 4 : 0,
    cursor: "pointer",
    fontSize: 13,
    color: dim ? "var(--ink-soft)" : "var(--ink)",
  }}>
    <span className="mono" style={{ fontSize: 11, color: "var(--ink-mute)", width: 22, textAlign: "right" }}>
      {String(idx).padStart(3, "0")}
    </span>
    <div className="mono" style={{
      width: 28, height: 28, flex: "0 0 28px",
      display: "grid", placeItems: "center",
      border: "1.2px solid var(--ink)", borderRadius: 3,
      background: "var(--bg)",
      fontSize: 9, fontWeight: 600, lineHeight: 1,
    }}>{c.glyph}</div>
    <div>
      <div style={{
        fontFamily: c.front && /[\u3040-\u9fff]/.test(c.front) ? "var(--font-cjk)" : '"JetBrains Mono", monospace',
        fontSize: 14, fontWeight: 500,
      }}>{c.front}</div>
      {c.reading && <div className="mono" style={{ fontSize: 10, color: "var(--accent)", marginTop: 2 }}>{c.reading}</div>}
    </div>
    <div className="mono" style={{ fontSize: 12, color: "var(--ink-soft)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
      {c.back}
    </div>
    <span className="mono" style={{ fontSize: 10, color: "var(--ink-mute)" }}>
      {c.deck}
    </span>
    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
      {c.tags.slice(0,2).map(t => (
        <span key={t} className="mono" style={{
          fontSize: 9, padding: "1px 6px",
          border: "1px solid var(--rule-soft)", borderRadius: 999,
          color: "var(--ink-soft)",
        }}>{t}</span>
      ))}
    </div>
    <span className="mono" style={{
      fontSize: 11, fontWeight: c.due === "now" ? 600 : 400,
      color: c.due === "now" ? "var(--due)" : "var(--ink-mute)",
      textAlign: "right",
    }}>{c.due}</span>
  </div>
);

const BrowseDetail = ({ c }) => (
  <aside style={{
    width: 360,
    borderLeft: "1.5px solid var(--ink)",
    background: "var(--bg-soft)",
    padding: "24px 22px",
    overflow: "auto",
    flexShrink: 0,
    display: "flex", flexDirection: "column", gap: 18,
  }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <Caption>// preview</Caption>
      <div style={{ display: "flex", gap: 6, color: "var(--ink-soft)" }}>
        <SketchGear size={14} />
        <span style={{ width: 1, height: 14, background: "var(--rule)" }} />
        <span className="mono" style={{ fontSize: 10 }}>×</span>
      </div>
    </div>

    <div style={{
      background: "var(--paper)",
      border: "1.5px solid var(--ink)",
      borderRadius: 6,
      padding: "20px 18px",
    }}>
      <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
        {c.tags.map(t => <Chip key={t} color="var(--ink-soft)">{t}</Chip>)}
      </div>
      <div style={{
        fontFamily: "var(--font-cjk)",
        fontSize: 36, fontWeight: 500, lineHeight: 1.15, textAlign: "center",
      }}>{c.front}</div>
      <div style={{ width: "60%", margin: "14px auto", borderTop: "1px dashed var(--rule)" }} />
      <div style={{ textAlign: "center" }}>
        {c.reading && <div className="mono" style={{ color: "var(--accent)", fontSize: 13 }}>{c.reading}</div>}
        <div className="mono" style={{ fontSize: 14, marginTop: 6 }}>{c.back}</div>
      </div>
    </div>

    <div>
      <Caption style={{ marginBottom: 8 }}>// scheduling</Caption>
      <KV k="state" v={c.state} />
      <KV k="due in" v={c.due} />
      <KV k="interval" v={`${c.interval}d`} />
      <KV k="ease" v={c.ease} />
      <KV k="reps" v="7" />
      <KV k="lapses" v="2" />
    </div>

    <div>
      <Caption style={{ marginBottom: 8 }}>// metadata</Caption>
      <KV k="deck" v={c.deck} />
      <KV k="note id" v={`#${c.id}`} />
      <KV k="added" v="2025-08-12" />
      <KV k="modified" v="2026-04-21" />
    </div>

    <div style={{ display: "flex", gap: 8, marginTop: "auto", flexWrap: "wrap" }}>
      <Btn kind="primary" size="sm">edit</Btn>
      <Btn kind="outline" size="sm">suspend</Btn>
      <Btn kind="ghost" size="sm">bury</Btn>
      <Btn kind="ghost" size="sm" style={{ marginLeft: "auto", color: "var(--due)" }}>delete</Btn>
    </div>
  </aside>
);

const KV = ({ k, v }) => (
  <div style={{
    display: "flex", justifyContent: "space-between",
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: 12,
    padding: "4px 0",
    borderBottom: "1px dashed var(--rule)",
  }}>
    <span style={{ color: "var(--ink-mute)", letterSpacing: "0.04em" }}>{k}</span>
    <span style={{ color: "var(--ink)" }}>{v}</span>
  </div>
);

/* Search bar */
const BrowseToolbar = ({ count = 121 }) => (
  <div style={{
    display: "flex", alignItems: "center", gap: 12,
    padding: "16px 0",
    borderBottom: "1.5px solid var(--ink)",
  }}>
    <div style={{
      flex: 1,
      display: "flex", alignItems: "center", gap: 8,
      padding: "8px 14px",
      border: "1.5px solid var(--ink)", borderRadius: 4,
      background: "var(--paper)",
      fontFamily: '"JetBrains Mono", monospace',
      boxShadow: "2px 2px 0 var(--ink)",
    }}>
      <SketchSearch size={14} />
      <span style={{ fontSize: 13, color: "var(--accent)" }}>deck:"日文 N2"</span>
      <span style={{ fontSize: 13, color: "var(--ink)" }}> tag:nature</span>
      <span style={{
        width: 1, height: 16, background: "var(--rule)",
        animation: "blink 1s infinite",
      }} />
      <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--ink-mute)", letterSpacing: "0.1em" }}>
        ⌘K
      </span>
    </div>
    <Btn kind="outline" size="sm" leading={<SketchPlus size={12} />}>filter</Btn>
    <Btn kind="paper" size="sm">save search</Btn>
    <span className="mono" style={{ fontSize: 11, color: "var(--ink-mute)" }}>
      {count} cards
    </span>
  </div>
);

const ColHeader = () => (
  <div className="mono" style={{
    display: "grid",
    gridTemplateColumns: "auto auto 1.6fr 1.4fr 80px 90px 70px",
    gap: 14,
    fontSize: 10, letterSpacing: "0.16em",
    color: "var(--ink-mute)",
    textTransform: "uppercase",
    padding: "10px 12px",
    borderBottom: "1px dashed var(--rule)",
  }}>
    <span style={{ width: 22, textAlign: "right" }}>#</span>
    <span style={{ width: 28 }}></span>
    <span>front</span>
    <span>back</span>
    <span>deck</span>
    <span>tags</span>
    <span style={{ textAlign: "right" }}>due</span>
  </div>
);

const BrowseV1 = ({ width = 1280, height = 880 }) => (
  <div className="theme grain" style={{ width, height, display: "flex", overflow: "hidden", position: "relative" }}>
    <BrowseSidebar />
    <main style={{ flex: 1, padding: "24px 32px 16px", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <Caption>// the.card.archive</Caption>
          <h1 style={{
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: 28, fontWeight: 600, margin: "6px 0 0",
            letterSpacing: "-0.02em",
          }}>browse
            <span className="hand" style={{ color: "var(--accent)", fontSize: 22, marginLeft: 12 }}>everything</span>
          </h1>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Btn kind="ghost" size="sm">import</Btn>
          <Btn kind="primary" size="sm" leading={<SketchPlus size={12} />}>new note</Btn>
        </div>
      </header>

      <BrowseToolbar />
      <ColHeader />

      <div style={{ flex: 1, overflow: "auto", paddingBottom: 8 }}>
        {BROWSE_CARDS.map((c, i) => (
          <BrowseRow key={c.id} c={c} idx={i + 1} selected={i === 0} />
        ))}
      </div>

      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        borderTop: "1px dashed var(--rule)", paddingTop: 12, marginTop: 4,
      }}>
        <Caption>// 10 of 121 · sorted by due asc</Caption>
        <div className="mono" style={{ fontSize: 11, color: "var(--ink-mute)", display: "flex", gap: 14 }}>
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>e edit</span>
          <span>⌫ delete</span>
        </div>
      </div>
    </main>
    <BrowseDetail c={BROWSE_CARDS[0]} />
  </div>
);

const BrowseMobile = ({ width = 390, height = 844 }) => (
  <div className="theme grain" style={{ width, height, position: "relative", overflow: "hidden", display: "flex", flexDirection: "column" }}>
    <header style={{
      padding: "48px 22px 12px",
      borderBottom: "1.5px solid var(--ink)",
      display: "flex", justifyContent: "space-between", alignItems: "center",
    }}>
      <div>
        <Caption>// browse</Caption>
        <div className="mono" style={{ fontSize: 14, fontWeight: 600, marginTop: 2 }}>121 cards</div>
      </div>
      <div style={{ display: "flex", gap: 12, color: "var(--ink-soft)" }}>
        <SketchSearch size={20} />
        <SketchPlus size={20} />
      </div>
    </header>

    <div style={{ padding: "12px 22px", borderBottom: "1px dashed var(--rule)" }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "8px 12px",
        border: "1.4px solid var(--ink)", borderRadius: 4,
        background: "var(--paper)",
        fontFamily: '"JetBrains Mono", monospace',
        boxShadow: "2px 2px 0 var(--ink)",
      }}>
        <SketchSearch size={13} />
        <span style={{ fontSize: 12, color: "var(--accent)" }}>tag:nature</span>
        <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--ink-mute)" }}>filter</span>
      </div>

      <div style={{ display: "flex", gap: 6, marginTop: 10, overflowX: "auto", paddingBottom: 4 }}>
        {["all", "new", "learning", "review", "suspended"].map((s, i) => (
          <span key={s} className="mono" style={{
            fontSize: 10, padding: "4px 10px",
            border: "1.2px solid var(--ink)", borderRadius: 999,
            background: i === 0 ? "var(--ink)" : "var(--paper)",
            color: i === 0 ? "var(--bg)" : "var(--ink-soft)",
            whiteSpace: "nowrap",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}>{s}</span>
        ))}
      </div>
    </div>

    <main style={{ flex: 1, overflow: "auto", padding: "12px 22px 24px", display: "flex", flexDirection: "column", gap: 10 }}>
      {BROWSE_CARDS.slice(0, 6).map((c, i) => (
        <a key={c.id} href="#" style={{
          textDecoration: "none", color: "var(--ink)",
          display: "block",
          background: "var(--paper)",
          border: "1.2px solid var(--ink)",
          borderRadius: 4,
          padding: "10px 14px",
          boxShadow: "2px 2px 0 var(--ink)",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div className="mono" style={{ fontSize: 9, color: "var(--ink-mute)", letterSpacing: "0.16em" }}>
              {String(i + 1).padStart(3, "0")} · {c.glyph}
            </div>
            <span className="mono" style={{
              fontSize: 10,
              color: c.due === "now" ? "var(--due)" : "var(--ink-mute)",
              fontWeight: c.due === "now" ? 600 : 400,
            }}>{c.due}</span>
          </div>
          <div style={{
            fontFamily: c.front && /[\u3040-\u9fff]/.test(c.front) ? "var(--font-cjk)" : '"JetBrains Mono", monospace',
            fontSize: 15, fontWeight: 500, marginTop: 4,
          }}>{c.front}</div>
          {c.reading && <div className="mono" style={{ fontSize: 10, color: "var(--accent)", marginTop: 1 }}>{c.reading}</div>}
          <div className="mono" style={{
            fontSize: 11, color: "var(--ink-soft)", marginTop: 4,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>{c.back}</div>
          <div style={{ display: "flex", gap: 4, marginTop: 8, flexWrap: "wrap" }}>
            {c.tags.map(t => (
              <span key={t} className="mono" style={{
                fontSize: 9, padding: "1px 6px",
                border: "1px solid var(--rule-soft)", borderRadius: 999,
                color: "var(--ink-mute)",
              }}>{t}</span>
            ))}
          </div>
        </a>
      ))}
    </main>

    <nav style={{
      borderTop: "1.5px solid var(--ink)",
      background: "var(--bg-soft)",
      display: "grid", gridTemplateColumns: "repeat(4, 1fr)",
      padding: "8px 0 22px",
    }}>
      {[
        { i: <SketchBook size={22} />, l: "decks" },
        { i: <SketchCardStack size={22} />, l: "browse", on: true },
        { i: <SketchPlus />, l: "add" },
        { i: <SketchCalendar size={22} />, l: "stats" },
      ].map((it, i) => (
        <div key={i} style={{
          display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
          color: it.on ? "var(--accent)" : "var(--ink-mute)",
        }}>
          {it.i}
          <span className="mono" style={{ fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase" }}>{it.l}</span>
        </div>
      ))}
    </nav>
  </div>
);

Object.assign(window, { BrowseV1, BrowseMobile });
