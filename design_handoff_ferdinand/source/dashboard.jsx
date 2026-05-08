/* Dashboard — deck list + today summary
   v1: ledger / list view (newspaper feel)
   v2: index-card grid
   Mobile: stacked cards
*/

const decks = [
  { id: "jp-n2", name: "日文 N2", glyph: "JP", n: 7, l: 5, r: 19, total: 2340, last: "2d ago", note: "JLPT prep" },
  { id: "rust", name: "Rust ownership", glyph: "RS", n: 3, l: 2, r: 8, total: 412, last: "3d ago", note: "borrow + lifetimes" },
  { id: "history", name: "World History", glyph: "HX", n: 0, l: 0, r: 15, total: 890, last: "4d ago", note: "byzantine → modern" },
  { id: "anatomy", name: "Anatomy", glyph: "AN", n: 12, l: 3, r: 22, total: 1567, last: "5d ago", note: "neuroanatomy focus" },
  { id: "piano", name: "Piano theory", glyph: "PT", n: 0, l: 0, r: 0, total: 203, last: "20d ago", note: "paused" },
];

const activity = [3, 8, 12, 9, 15, 22, 18, 25, 30, 26, 19, 24, 31, 28, 17, 20, 29, 35, 27, 22, 0, 24, 18, 26, 30, 33, 28, 25, 19, 22];

const NavRail = () => (
  <aside style={{
    width: 220,
    background: "var(--bg-soft)",
    borderRight: "1.5px solid var(--ink)",
    padding: "28px 22px",
    display: "flex",
    flexDirection: "column",
    gap: 4,
    flexShrink: 0,
  }}>
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 32 }}>
      <FerdinandMark size={28} />
      <div className="mono" style={{ fontSize: 14, fontWeight: 600 }}>Ferdinand</div>
    </div>

    <Caption style={{ marginBottom: 10 }}>// nav</Caption>
    <NavLink active icon={<SketchBook size={70} />} label="Decks" badge="69" />
    <NavLink icon={<SketchCardStack size={70} />} label="Browse" />
    <NavLink icon={<SketchPlus />} label="New note" />
    <NavLink icon={<SketchCalendar size={70} />} label="Stats" />

    <div style={{ height: 18 }} />
    <Caption style={{ marginBottom: 10 }}>// pinned</Caption>
    <NavLink small label="leeches" hint="tag:leech" />
    <NavLink small label="added today" hint="added:1" />
    <NavLink small label="hard rust" hint="rated:1:1" />

    <div style={{ marginTop: "auto", borderTop: "1px dashed var(--rule)", paddingTop: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <div style={{
          width: 32, height: 32, borderRadius: 4,
          background: "var(--accent)", color: "var(--bg)",
          display: "grid", placeItems: "center",
          fontFamily: '"JetBrains Mono", monospace', fontSize: 13, fontWeight: 600,
        }}>kw</div>
        <div style={{ lineHeight: 1.2 }}>
          <div className="mono" style={{ fontSize: 12, fontWeight: 600 }}>ktwu</div>
          <div className="mono" style={{ fontSize: 10, color: "var(--ink-mute)" }}>sync.ktwu.dev</div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <Btn kind="ghost" size="sm" leading={<SketchGear size={14} />}>settings</Btn>
      </div>
    </div>
  </aside>
);

const NavLink = ({ active, label, icon, badge, small, hint }) => (
  <a href="#" style={{
    display: "flex", alignItems: "center", justifyContent: "space-between",
    gap: 10, padding: small ? "5px 10px" : "8px 10px",
    borderRadius: 4, textDecoration: "none",
    color: active ? "var(--ink)" : "var(--ink-soft)",
    background: active ? "var(--paper)" : "transparent",
    border: active ? "1.2px solid var(--ink)" : "1.2px solid transparent",
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: small ? 11 : 13,
    letterSpacing: "0.02em",
  }}>
    <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
      {icon && <span style={{ display: "flex", color: "var(--ink-soft)" }}>{icon}</span>}
      {!icon && small && <span style={{ color: "var(--ink-mute)", marginRight: 2 }}>·</span>}
      {label}
    </span>
    {badge && <span className="mono" style={{ fontSize: 10, color: "var(--accent)", fontWeight: 600 }}>{badge}</span>}
    {hint && <span className="mono" style={{ fontSize: 10, color: "var(--ink-mute)" }}>{hint}</span>}
  </a>
);

/* Top summary band — used in both v1 + v2 */
const TodaySummary = ({ compact }) => (
  <div style={{
    display: "grid",
    gridTemplateColumns: compact ? "1fr 1fr 1fr 1fr" : "1.6fr 1fr 1fr 1fr 1.4fr",
    gap: 24,
    padding: "24px 0",
    borderTop: "1.5px solid var(--ink)",
    borderBottom: "1.5px solid var(--ink)",
    alignItems: "center",
  }}>
    {!compact && (
      <div>
        <Caption>// today</Caption>
        <div style={{
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: 18, fontWeight: 500, marginTop: 6,
        }}>2026·05·08 thursday</div>
        <div style={{ fontSize: 13, color: "var(--ink-soft)", marginTop: 4 }}>
          good morning, ktwu — <span className="hand" style={{ color: "var(--accent)", fontSize: 17 }}>69 cards waiting.</span>
        </div>
      </div>
    )}
    <Stat label="due now" value="69" hue="due" />
    <Stat label="reviewed" value="42" hue="accent" />
    <Stat label="streak" value="14d" icon={<SketchFlame size={16} />} hue="warn" />
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <Caption>// last 30 days</Caption>
      <ActivityBars data={activity} width={compact ? 200 : 220} height={36} />
    </div>
  </div>
);

const Stat = ({ label, value, icon, hue }) => (
  <div>
    <Caption>// {label}</Caption>
    <div style={{
      display: "flex", alignItems: "baseline", gap: 6,
      fontFamily: '"JetBrains Mono", monospace',
      fontSize: 32, fontWeight: 500, marginTop: 4,
      color: hue === "due" ? "var(--due)" : hue === "warn" ? "var(--warn)" : hue === "accent" ? "var(--accent)" : "var(--ink)",
      letterSpacing: "-0.02em",
    }}>
      {value}
      {icon && <span style={{ color: "var(--warn)" }}>{icon}</span>}
    </div>
  </div>
);

/* — VARIATION 1 : ledger / list ————————————————————————— */
const DashboardV1 = ({ width = 1280, height = 880 }) => (
  <div className="theme grain" style={{ width, height, display: "flex", overflow: "hidden" }}>
    <NavRail />

    <main style={{ flex: 1, padding: "40px 56px 32px", overflow: "auto", position: "relative" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <Caption>// the.deck.ledger</Caption>
          <h1 style={{
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: 38, fontWeight: 600, margin: "8px 0 0",
            letterSpacing: "-0.02em", position: "relative",
          }}>
            decks
            <span style={{ position: "absolute", left: 0, bottom: -10 }}>
              <SketchUnderline width={88} />
            </span>
          </h1>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <Btn kind="outline" leading={<SketchSearch size={14} />}>search</Btn>
          <Btn kind="primary" leading={<SketchPlus size={14} />}>new deck</Btn>
        </div>
      </header>

      <div style={{ marginTop: 28 }}>
        <TodaySummary />
      </div>

      {/* table-like list */}
      <div style={{ marginTop: 24 }}>
        <div className="mono" style={{
          display: "grid",
          gridTemplateColumns: "auto 2fr 90px 90px 90px 1.4fr auto",
          gap: 16,
          fontSize: 10, letterSpacing: "0.16em",
          color: "var(--ink-mute)",
          textTransform: "uppercase",
          padding: "10px 8px",
          borderBottom: "1px dashed var(--rule)",
        }}>
          <span>idx</span>
          <span>deck</span>
          <span style={{ textAlign: "right" }}>new</span>
          <span style={{ textAlign: "right" }}>learn</span>
          <span style={{ textAlign: "right" }}>review</span>
          <span>queue</span>
          <span></span>
        </div>

        {decks.map((d, i) => <DeckRow key={d.id} d={d} idx={i + 1} />)}
      </div>

      <div style={{
        marginTop: 28,
        display: "flex", justifyContent: "space-between", alignItems: "center",
        borderTop: "1px dashed var(--rule)", paddingTop: 16,
      }}>
        <Caption>// 5 decks · 5,412 cards · 64.0% retention (30d)</Caption>
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--accent)" }}>
          <SketchLeaf size={20} />
          <span className="hand" style={{ fontSize: 18 }}>steady wins.</span>
        </div>
      </div>
    </main>
  </div>
);

const DeckRow = ({ d, idx }) => {
  const due = d.n + d.l + d.r;
  return (
    <a href="#" style={{
      display: "grid",
      gridTemplateColumns: "auto 2fr 90px 90px 90px 1.4fr auto",
      gap: 16,
      alignItems: "center",
      padding: "16px 8px",
      borderBottom: "1px solid var(--rule-soft)",
      textDecoration: "none",
      color: "var(--ink)",
      position: "relative",
    }}>
      <span className="mono" style={{ fontSize: 11, color: "var(--ink-mute)" }}>{String(idx).padStart(2, "0")}</span>

      <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0 }}>
        <div className="mono" style={{
          width: 40, height: 40,
          flex: "0 0 40px",
          display: "grid", placeItems: "center",
          border: "1.4px solid var(--ink)", borderRadius: 4,
          background: "var(--paper)", fontSize: 11, fontWeight: 600,
          letterSpacing: "0.04em",
          textAlign: "center",
          lineHeight: 1,
        }}>{d.glyph}</div>
        <div>
          <div style={{ fontSize: 16, fontWeight: 500 }}>{d.name}</div>
          <div style={{ fontSize: 12, color: "var(--ink-mute)", display: "flex", gap: 12, alignItems: "center", marginTop: 2 }}>
            <span>{d.note}</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <SketchClock size={11} />{d.last}
            </span>
            <span className="mono">· {d.total} cards</span>
          </div>
        </div>
      </div>

      <span className="mono" style={{ textAlign: "right", color: d.n > 0 ? "var(--due)" : "var(--ink-mute)", fontWeight: d.n > 0 ? 600 : 400 }}>{d.n}</span>
      <span className="mono" style={{ textAlign: "right", color: d.l > 0 ? "var(--warn)" : "var(--ink-mute)", fontWeight: d.l > 0 ? 600 : 400 }}>{d.l}</span>
      <span className="mono" style={{ textAlign: "right", color: d.r > 0 ? "var(--accent)" : "var(--ink-mute)", fontWeight: d.r > 0 ? 600 : 400 }}>{d.r}</span>

      <QueueBar n={d.n} l={d.l} r={d.r} total={d.total} width={170} />

      <Btn
        kind={due ? "primary" : "outline"}
        size="sm"
        trailing={due ? <SketchArrow size={14} /> : null}
        style={due ? {} : { opacity: 0.5 }}
      >
        {due ? "study" : "rest"}
      </Btn>
    </a>
  );
};

/* — VARIATION 2 : index-card grid ————————————————————————— */
const DashboardV2 = ({ width = 1280, height = 880 }) => (
  <div className="theme grain" style={{ width, height, display: "flex", overflow: "hidden" }}>
    <NavRail />
    <main style={{ flex: 1, padding: "40px 48px 32px", overflow: "auto", position: "relative" }}>

      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <Caption>// 2026·05·08</Caption>
          <h1 style={{
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: 32, fontWeight: 500, margin: "6px 0 0",
            letterSpacing: "-0.01em",
          }}>
            morning, ktwu.
            <span className="hand" style={{ color: "var(--accent)", fontSize: 24, marginLeft: 12 }}>
              ☉
            </span>
          </h1>
          <p style={{ fontSize: 14, color: "var(--ink-soft)", margin: "8px 0 0" }}>
            you have <strong style={{ color: "var(--due)" }}>69 cards</strong> due across 4 decks.
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Stat label="streak" value="14d" icon={<SketchFlame size={14} />} hue="warn" />
          <div style={{ width: 1, height: 40, background: "var(--rule)" }} />
          <SketchPlant size={64} />
        </div>
      </header>

      {/* big "today" call-to-action */}
      <div style={{
        marginTop: 28,
        position: "relative",
        background: "var(--accent)",
        color: "var(--bg)",
        border: "1.5px solid var(--ink)",
        borderRadius: 6,
        padding: "26px 32px",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        boxShadow: "4px 4px 0 var(--ink)",
        overflow: "hidden",
      }}>
        <div>
          <div className="mono" style={{ fontSize: 11, letterSpacing: "0.16em", opacity: 0.8, textTransform: "uppercase" }}>
            // start where you left off
          </div>
          <div style={{
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: 26, fontWeight: 600, margin: "6px 0 4px",
          }}>日文 N2 · 31 due</div>
          <div className="mono" style={{ fontSize: 12, opacity: 0.85 }}>
            7 new · 5 learning · 19 review · est. 14 min
          </div>
        </div>
        <Btn
          size="lg"
          trailing={<SketchArrow />}
          style={{
            background: "var(--bg)", color: "var(--ink)",
            borderColor: "var(--ink)",
            boxShadow: "3px 3px 0 var(--ink)",
          }}>
          continue
        </Btn>
        <div style={{ position: "absolute", right: -10, top: -10, opacity: 0.18 }}>
          <SketchCardStack size={140} />
        </div>
      </div>

      {/* deck grid */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 32, marginBottom: 14 }}>
        <Caption>// all decks</Caption>
        <div style={{ display: "flex", gap: 8 }}>
          <Btn kind="ghost" size="sm" leading={<SketchSearch size={12} />}>search</Btn>
          <Btn kind="paper" size="sm" leading={<SketchPlus size={12} />}>new</Btn>
        </div>
      </div>

      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, 1fr)",
        gap: 18,
      }}>
        {decks.map((d, i) => <DeckCard key={d.id} d={d} idx={i + 1} />)}
        <NewDeckCard />
      </div>
    </main>
  </div>
);

const DeckCard = ({ d, idx }) => {
  const due = d.n + d.l + d.r;
  const tilt = (idx % 3 === 0 ? -0.6 : idx % 3 === 1 ? 0.4 : -0.2);
  return (
    <a href="#" style={{
      position: "relative",
      background: "var(--paper)",
      border: "1.5px solid var(--ink)",
      borderRadius: 4,
      padding: "20px 22px 18px",
      textDecoration: "none",
      color: "var(--ink)",
      transform: `rotate(${tilt}deg)`,
      boxShadow: "3px 3px 0 var(--ink)",
      display: "flex",
      flexDirection: "column",
      gap: 12,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div className="mono" style={{ fontSize: 10, color: "var(--ink-mute)", letterSpacing: "0.16em" }}>
          {String(idx).padStart(2, "0")} · {d.glyph}
        </div>
        {due > 0 ? (
          <Chip color="var(--due)">{due} due</Chip>
        ) : (
          <Chip color="var(--ink-mute)">resting</Chip>
        )}
      </div>

      <div>
        <div style={{
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: 20, fontWeight: 600,
        }}>{d.name}</div>
        <div className="mono" style={{ fontSize: 11, color: "var(--ink-mute)", marginTop: 2 }}>
          {d.note}
        </div>
      </div>

      <div style={{ display: "flex", gap: 14, marginTop: 4 }}>
        <DeckCounter label="new" value={d.n} color="var(--due)" />
        <DeckCounter label="learn" value={d.l} color="var(--warn)" />
        <DeckCounter label="review" value={d.r} color="var(--accent)" />
      </div>

      <QueueBar n={d.n} l={d.l} r={d.r} total={d.total} width={"100%"} />

      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        marginTop: "auto", paddingTop: 8,
        borderTop: "1px dashed var(--rule)",
      }}>
        <span className="mono" style={{ fontSize: 10, color: "var(--ink-mute)", display: "inline-flex", alignItems: "center", gap: 4 }}>
          <SketchClock size={11} />{d.last} · {d.total}
        </span>
        <span className="mono" style={{
          fontSize: 11, color: due ? "var(--accent)" : "var(--ink-mute)", letterSpacing: "0.06em",
          display: "inline-flex", alignItems: "center", gap: 4,
        }}>
          {due ? "study" : "review"} <SketchArrow size={12} />
        </span>
      </div>
    </a>
  );
};

const DeckCounter = ({ label, value, color }) => (
  <div>
    <div className="mono" style={{ fontSize: 10, color: "var(--ink-mute)", letterSpacing: "0.1em", textTransform: "uppercase" }}>{label}</div>
    <div className="mono" style={{ fontSize: 18, color: value > 0 ? color : "var(--ink-mute)", fontWeight: value > 0 ? 600 : 400 }}>
      {value}
    </div>
  </div>
);

const NewDeckCard = () => (
  <a href="#" style={{
    border: "1.5px dashed var(--rule)",
    borderRadius: 4,
    padding: 22,
    textDecoration: "none",
    color: "var(--ink-soft)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    minHeight: 200,
    background: "transparent",
  }}>
    <SketchPlus size={28} />
    <div className="mono" style={{ fontSize: 12, letterSpacing: "0.1em" }}>new deck</div>
    <div className="hand" style={{ color: "var(--accent)", fontSize: 18, marginTop: 4 }}>
      what do you want to remember?
    </div>
  </a>
);

/* — Mobile —————————————————————————————————— */
const DashboardMobile = ({ width = 390, height = 844 }) => (
  <div className="theme grain" style={{ width, height, position: "relative", overflow: "hidden", display: "flex", flexDirection: "column" }}>
    {/* top bar */}
    <header style={{
      padding: "48px 22px 14px",
      borderBottom: "1px dashed var(--rule)",
      display: "flex", justifyContent: "space-between", alignItems: "center",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <FerdinandMark size={24} />
        <div className="mono" style={{ fontSize: 13, fontWeight: 600 }}>Ferdinand</div>
      </div>
      <div style={{ display: "flex", gap: 12, color: "var(--ink-soft)" }}>
        <SketchSearch size={18} />
        <SketchUser size={18} />
      </div>
    </header>

    <main style={{ flex: 1, overflow: "auto", padding: "20px 22px 24px" }}>
      <Caption>// 2026·05·08</Caption>
      <h1 style={{
        fontFamily: '"JetBrains Mono", monospace',
        fontSize: 22, fontWeight: 500, margin: "6px 0 0",
      }}>morning, ktwu.</h1>
      <p style={{ fontSize: 13, color: "var(--ink-soft)", margin: "6px 0 0" }}>
        <strong style={{ color: "var(--due)" }}>69 cards</strong> waiting · 14d streak <SketchFlame size={12} />
      </p>

      {/* hero CTA */}
      <div style={{
        marginTop: 18,
        background: "var(--accent)",
        color: "var(--bg)",
        border: "1.4px solid var(--ink)",
        borderRadius: 6,
        boxShadow: "3px 3px 0 var(--ink)",
        padding: "14px 16px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: 8,
      }}>
        <div>
          <div className="mono" style={{ fontSize: 9, letterSpacing: "0.18em", opacity: 0.8 }}>// CONTINUE</div>
          <div className="mono" style={{ fontSize: 16, fontWeight: 600, marginTop: 4 }}>日文 N2</div>
          <div className="mono" style={{ fontSize: 10, opacity: 0.85 }}>31 due · ~14 min</div>
        </div>
        <SketchArrow size={20} />
      </div>

      <Caption style={{ marginTop: 22, marginBottom: 8 }}>// decks</Caption>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {decks.map((d, i) => <DeckRowMobile key={d.id} d={d} idx={i + 1} />)}
      </div>

      <div style={{ display: "flex", justifyContent: "center", marginTop: 20, color: "var(--accent)" }}>
        <SketchLeaf size={20} />
      </div>
    </main>

    {/* bottom nav */}
    <nav style={{
      borderTop: "1.5px solid var(--ink)",
      background: "var(--bg-soft)",
      display: "grid", gridTemplateColumns: "repeat(4, 1fr)",
      padding: "8px 0 22px",
    }}>
      {[
        { i: <SketchBook size={22} />, l: "decks", on: true },
        { i: <SketchCardStack size={22} />, l: "browse" },
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

const DeckRowMobile = ({ d, idx }) => {
  const due = d.n + d.l + d.r;
  return (
    <a href="#" style={{
      display: "block",
      padding: "12px 14px",
      border: "1.2px solid var(--ink)",
      borderRadius: 4,
      background: "var(--paper)",
      boxShadow: "2px 2px 0 var(--ink)",
      textDecoration: "none",
      color: "var(--ink)",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div className="mono" style={{ fontSize: 9, color: "var(--ink-mute)", letterSpacing: "0.16em" }}>{String(idx).padStart(2,"0")} · {d.glyph}</div>
          <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 14, fontWeight: 600, marginTop: 2 }}>{d.name}</div>
        </div>
        {due > 0 ? <Chip color="var(--due)">{due} due</Chip> : <Chip color="var(--ink-mute)">rest</Chip>}
      </div>

      <div style={{ marginTop: 10, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <QueueBar n={d.n} l={d.l} r={d.r} width={170} />
        <span className="mono" style={{ fontSize: 10, color: "var(--ink-mute)" }}>{d.total}</span>
      </div>
    </a>
  );
};

Object.assign(window, { DashboardV1, DashboardV2, DashboardMobile });
