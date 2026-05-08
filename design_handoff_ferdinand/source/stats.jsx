/* Stats — daily progress, retention, heatmap, deck breakdown */

const STATS_HERO = [
  { l: "streak", v: "14", u: "days", color: "var(--accent)" },
  { l: "retention", v: "91", u: "% · 30d", color: "var(--ink)" },
  { l: "reviewed", v: "1,284", u: "this month", color: "var(--ink)" },
  { l: "mature cards", v: "3,802", u: "of 5,412", color: "var(--ink)" },
];

/* Reviews per day — 30-day bar chart, deterministic */
const buildBars = () =>
  Array.from({ length: 30 }, (_, i) => {
    const seed = (i * 9301 + 49297) % 233280;
    const h = 28 + Math.round((seed / 233280) * 78);
    const dip = i % 7 === 6 ? 0.55 : 1; // Sunday-ish dip
    return { h: Math.round(h * dip), again: Math.round(h * dip * 0.18), good: Math.round(h * dip * 0.66) };
  });

const ReviewBars = ({ width = 520, height = 140 }) => {
  const bars = buildBars();
  const max = Math.max(...bars.map(b => b.h));
  const bw = (width - 14) / bars.length;
  return (
    <svg viewBox={`0 0 ${width} ${height + 30}`} width={width} height={height + 30} className="sketch" style={{ display: "block" }} aria-hidden="true">
      <line x1="0" y1={height} x2={width} y2={height} className="sketch" style={{ stroke: "var(--ink)" }} strokeWidth="1.4" />
      {[0.25, 0.5, 0.75].map((p, i) => (
        <line key={i} x1="0" y1={height - height * p} x2={width} y2={height - height * p}
              stroke="var(--rule)" strokeWidth="1" strokeDasharray="2 4" />
      ))}
      {bars.map((b, i) => {
        const x = i * bw + 4;
        const fullH = (b.h / max) * (height - 8);
        const goodH = (b.good / max) * (height - 8);
        return (
          <g key={i}>
            <rect x={x} y={height - fullH} width={bw - 5} height={fullH} fill="var(--accent-soft)" stroke="var(--ink)" strokeWidth="1" />
            <rect x={x} y={height - goodH} width={bw - 5} height={goodH} fill="var(--accent)" stroke="var(--ink)" strokeWidth="1" />
          </g>
        );
      })}
      <text x="0" y={height + 18} fontFamily="JetBrains Mono" fontSize="10" fill="var(--ink-mute)">apr 1</text>
      <text x={width / 2 - 14} y={height + 18} fontFamily="JetBrains Mono" fontSize="10" fill="var(--ink-mute)">apr 15</text>
      <text x={width - 38} y={height + 18} fontFamily="JetBrains Mono" fontSize="10" fill="var(--ink-mute)">apr 30</text>
    </svg>
  );
};

/* Retention curve */
const RetentionCurve = ({ width = 520, height = 140 }) => {
  const points = Array.from({ length: 30 }, (_, i) => {
    const seed = (i * 4783 + 12377) % 233280;
    const r = 0.78 + (seed / 233280) * 0.18;
    return { x: (i / 29) * (width - 4) + 2, y: height - (r - 0.7) * (height / 0.3) - 4 };
  });
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  return (
    <svg viewBox={`0 0 ${width} ${height + 30}`} width={width} height={height + 30} className="sketch" style={{ display: "block" }} aria-hidden="true">
      <line x1="0" y1={height} x2={width} y2={height} stroke="var(--ink)" strokeWidth="1.4" />
      {[0.7, 0.8, 0.9, 1].map((p, i) => (
        <g key={i}>
          <line x1="0" y1={height - (p - 0.7) * (height / 0.3)} x2={width} y2={height - (p - 0.7) * (height / 0.3)}
                stroke="var(--rule)" strokeWidth="1" strokeDasharray="2 4" />
          <text x={width - 26} y={height - (p - 0.7) * (height / 0.3) - 3} fontFamily="JetBrains Mono" fontSize="9" fill="var(--ink-mute)">{Math.round(p * 100)}%</text>
        </g>
      ))}
      <path d={path} fill="none" stroke="var(--accent)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      {points.filter((_, i) => i % 5 === 0).map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="2.4" fill="var(--paper)" stroke="var(--accent)" strokeWidth="1.2" />
      ))}
    </svg>
  );
};

/* Heatmap — 7x20 grid */
const Heatmap = ({ width = 520, rows = 7, cols = 20, cell = 18, gap = 4 }) => {
  const cells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const seed = ((r * 31 + c * 17) * 9301 + 49297) % 233280;
      const v = (seed / 233280);
      let level = 0;
      if (v > 0.85) level = 4;
      else if (v > 0.6) level = 3;
      else if (v > 0.4) level = 2;
      else if (v > 0.2) level = 1;
      cells.push({ r, c, level });
    }
  }
  const colors = [
    "var(--paper)",
    "color-mix(in oklch, var(--accent) 18%, var(--paper))",
    "color-mix(in oklch, var(--accent) 38%, var(--paper))",
    "color-mix(in oklch, var(--accent) 65%, var(--paper))",
    "var(--accent)",
  ];
  const gridW = cols * (cell + gap);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, width }}>
      <div style={{ width: gridW, margin: "0 auto" }}>
        <svg viewBox={`0 0 ${gridW} ${rows * (cell + gap)}`} width={gridW} height={rows * (cell + gap)}>
          {cells.map(c => (
            <rect key={`${c.r}-${c.c}`}
              x={c.c * (cell + gap)} y={c.r * (cell + gap)}
              width={cell} height={cell} rx="2"
              fill={colors[c.level]}
              stroke="var(--ink)" strokeWidth="0.9" />
          ))}
        </svg>
      </div>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        fontFamily: '"JetBrains Mono", monospace', fontSize: 10, color: "var(--ink-mute)",
        width: gridW, margin: "0 auto",
      }}>
        <span>20 weeks ago</span>
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
          less
          {colors.map((c, i) => (
            <span key={i} style={{ width: 11, height: 11, background: c, border: "1px solid var(--ink)", borderRadius: 2, display: "inline-block" }} />
          ))}
          more
        </span>
        <span>today</span>
      </div>
    </div>
  );
};

const HeroStat = ({ stat }) => (
  <div style={{
    flex: 1, padding: "20px 22px",
    background: "var(--paper)",
    border: "1.5px solid var(--ink)", borderRadius: 4,
    boxShadow: "3px 3px 0 var(--ink)",
  }}>
    <Caption>// {stat.l}</Caption>
    <div style={{
      fontFamily: '"JetBrains Mono", monospace', fontWeight: 600,
      fontSize: 38, lineHeight: 1, marginTop: 8, letterSpacing: "-0.02em",
      color: stat.color,
    }}>{stat.v}<span style={{ fontSize: 13, fontWeight: 400, color: "var(--ink-mute)", marginLeft: 6 }}>{stat.u}</span></div>
  </div>
);

const StatsV1 = ({ width = 1280, height = 880 }) => (
  <div className="theme grain" style={{ width, height, display: "flex", overflow: "hidden" }}>
    <NavRail />
    <main style={{ flex: 1, padding: "32px 48px", overflow: "auto", display: "flex", flexDirection: "column", gap: 24 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <Caption>// the.ledger</Caption>
          <h1 style={{
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: 28, fontWeight: 600, margin: "6px 0 0", letterSpacing: "-0.02em",
          }}>statistics
            <span className="hand" style={{ color: "var(--accent)", fontSize: 22, marginLeft: 12 }}>
              past 30 days
            </span>
          </h1>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {["7d", "30d", "year", "all time"].map((p, i) => (
            <span key={p} className="mono" style={{
              fontSize: 11, padding: "6px 12px",
              border: "1.2px solid var(--ink)", borderRadius: 4,
              background: i === 1 ? "var(--ink)" : "var(--paper)",
              color: i === 1 ? "var(--bg)" : "var(--ink-soft)",
              letterSpacing: "0.06em",
              cursor: "pointer",
            }}>{p}</span>
          ))}
        </div>
      </header>

      <div style={{ display: "flex", gap: 14 }}>
        {STATS_HERO.map(s => <HeroStat key={s.l} stat={s} />)}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <div style={{
          background: "var(--paper)", border: "1.5px solid var(--ink)",
          borderRadius: 4, padding: "18px 22px", boxShadow: "3px 3px 0 var(--ink)",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <Caption>// reviews per day</Caption>
            <span className="mono" style={{ fontSize: 11, color: "var(--ink-mute)" }}>
              <span style={{ color: "var(--accent)" }}>■</span> good · <span style={{ color: "var(--accent-soft)" }}>■</span> total
            </span>
          </div>
          <ReviewBars width={520} />
        </div>
        <div style={{
          background: "var(--paper)", border: "1.5px solid var(--ink)",
          borderRadius: 4, padding: "18px 22px", boxShadow: "3px 3px 0 var(--ink)",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <Caption>// retention</Caption>
            <span className="mono" style={{ fontSize: 11, color: "var(--ink-mute)" }}>target 90%</span>
          </div>
          <RetentionCurve width={520} />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 20 }}>
        <div style={{
          background: "var(--paper)", border: "1.5px solid var(--ink)",
          borderRadius: 4, padding: "18px 22px", boxShadow: "3px 3px 0 var(--ink)",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <Caption>// activity heatmap</Caption>
            <span className="mono" style={{ fontSize: 11, color: "var(--ink-mute)" }}>140 days · 14d streak</span>
          </div>
          <Heatmap />
        </div>
        <div style={{
          background: "var(--paper)", border: "1.5px solid var(--ink)",
          borderRadius: 4, padding: "18px 22px", boxShadow: "3px 3px 0 var(--ink)",
        }}>
          <Caption>// answer distribution</Caption>
          <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 12 }}>
            {[
              { l: "again", v: 84,  pct: 12, c: "var(--due)" },
              { l: "hard",  v: 132, pct: 19, c: "var(--warn)" },
              { l: "good",  v: 412, pct: 59, c: "var(--accent)" },
              { l: "easy",  v: 71,  pct: 10, c: "var(--easy, #4a6c8e)" },
            ].map(d => (
              <div key={d.l}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
                  <span className="mono" style={{ fontSize: 12, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.06em", color: d.c }}>{d.l}</span>
                  <span className="mono" style={{ fontSize: 11, color: "var(--ink-mute)" }}>{d.v} · {d.pct}%</span>
                </div>
                <div style={{ height: 10, background: "var(--bg-soft)", border: "1px solid var(--ink)", borderRadius: 999, overflow: "hidden" }}>
                  <div style={{ width: `${d.pct}%`, height: "100%", background: d.c }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{
        background: "var(--paper)", border: "1.5px solid var(--ink)",
        borderRadius: 4, padding: "18px 22px", boxShadow: "3px 3px 0 var(--ink)",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <Caption>// deck breakdown</Caption>
          <span className="mono" style={{ fontSize: 11, color: "var(--ink-mute)" }}>5 active decks</span>
        </div>
        <div className="mono" style={{
          display: "grid", gridTemplateColumns: "1.6fr 80px 80px 80px 1.2fr 80px",
          gap: 14, fontSize: 10, color: "var(--ink-mute)",
          textTransform: "uppercase", letterSpacing: "0.16em",
          padding: "8px 0", borderBottom: "1px dashed var(--rule)",
        }}>
          <span>deck</span><span style={{ textAlign: "right" }}>cards</span><span style={{ textAlign: "right" }}>mature</span><span style={{ textAlign: "right" }}>retention</span><span>activity</span><span style={{ textAlign: "right" }}>last</span>
        </div>
        {[
          { g: "JP", n: "日文 N2", c: 2340, m: 1820, r: 92, l: "today", a: 0.85 },
          { g: "RS", n: "Rust ownership", c: 412, m: 388, r: 96, l: "today", a: 0.55 },
          { g: "HX", n: "World History", c: 890, m: 712, r: 88, l: "1d", a: 0.42 },
          { g: "AN", n: "Anatomy", c: 1567, m: 824, r: 79, l: "2d", a: 0.6 },
          { g: "PT", n: "Piano theory", c: 203, m: 58, r: 84, l: "11d", a: 0.1 },
        ].map((d, i) => (
          <div key={d.n} style={{
            display: "grid", gridTemplateColumns: "1.6fr 80px 80px 80px 1.2fr 80px",
            gap: 14, alignItems: "center",
            padding: "12px 0",
            borderBottom: i === 4 ? "none" : "1px solid var(--rule-soft)",
            fontFamily: '"JetBrains Mono", monospace', fontSize: 12,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{
                width: 26, height: 26, display: "grid", placeItems: "center",
                border: "1.2px solid var(--ink)", borderRadius: 3, fontSize: 9, fontWeight: 600,
                background: "var(--bg-soft)",
              }}>{d.g}</span>
              <span style={{ fontWeight: 500 }}>{d.n}</span>
            </div>
            <span style={{ textAlign: "right" }}>{d.c.toLocaleString()}</span>
            <span style={{ textAlign: "right", color: "var(--ink-soft)" }}>{d.m.toLocaleString()}</span>
            <span style={{ textAlign: "right", color: d.r >= 90 ? "var(--accent)" : "var(--warn)" }}>{d.r}%</span>
            <div style={{ height: 6, background: "var(--bg-soft)", border: "1px solid var(--ink)", borderRadius: 999, overflow: "hidden" }}>
              <div style={{ width: `${d.a * 100}%`, height: "100%", background: "var(--accent)" }} />
            </div>
            <span style={{ textAlign: "right", color: "var(--ink-mute)" }}>{d.l}</span>
          </div>
        ))}
      </div>
    </main>
  </div>
);

const StatsMobile = ({ width = 390, height = 844 }) => (
  <div className="theme grain" style={{ width, height, position: "relative", overflow: "hidden", display: "flex", flexDirection: "column" }}>
    <header style={{
      padding: "48px 22px 14px",
      borderBottom: "1.5px solid var(--ink)",
    }}>
      <Caption>// stats</Caption>
      <div className="mono" style={{ fontSize: 18, fontWeight: 600, marginTop: 4 }}>past 30 days</div>
    </header>

    <main style={{ flex: 1, overflow: "auto", padding: "16px 22px 96px", display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {STATS_HERO.map(s => (
          <div key={s.l} style={{
            background: "var(--paper)", border: "1.4px solid var(--ink)",
            borderRadius: 4, padding: "12px 14px", boxShadow: "2px 2px 0 var(--ink)",
          }}>
            <Caption style={{ fontSize: 9 }}>// {s.l}</Caption>
            <div style={{
              fontFamily: '"JetBrains Mono", monospace', fontWeight: 600,
              fontSize: 22, marginTop: 4, color: s.color, lineHeight: 1,
            }}>{s.v}<span style={{ fontSize: 10, color: "var(--ink-mute)", fontWeight: 400, marginLeft: 4 }}>{s.u}</span></div>
          </div>
        ))}
      </div>

      <div style={{
        background: "var(--paper)", border: "1.4px solid var(--ink)",
        borderRadius: 4, padding: "14px 16px", boxShadow: "2px 2px 0 var(--ink)",
      }}>
        <Caption>// reviews per day</Caption>
        <div style={{ marginTop: 10 }}>
          <ReviewBars width={310} height={100} />
        </div>
      </div>

      <div style={{
        background: "var(--paper)", border: "1.4px solid var(--ink)",
        borderRadius: 4, padding: "14px 16px", boxShadow: "2px 2px 0 var(--ink)",
      }}>
        <Caption>// retention</Caption>
        <div style={{ marginTop: 10 }}>
          <RetentionCurve width={310} height={90} />
        </div>
      </div>

      <div style={{
        background: "var(--paper)", border: "1.4px solid var(--ink)",
        borderRadius: 4, padding: "14px 16px", boxShadow: "2px 2px 0 var(--ink)",
      }}>
        <Caption>// answer mix</Caption>
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
          {[
            { l: "again", v: 84, pct: 12, c: "var(--due)" },
            { l: "hard",  v: 132, pct: 19, c: "var(--warn)" },
            { l: "good",  v: 412, pct: 59, c: "var(--accent)" },
            { l: "easy",  v: 71, pct: 10, c: "var(--easy, #4a6c8e)" },
          ].map(d => (
            <div key={d.l}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                <span className="mono" style={{ fontSize: 11, color: d.c, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 500 }}>{d.l}</span>
                <span className="mono" style={{ fontSize: 10, color: "var(--ink-mute)" }}>{d.pct}%</span>
              </div>
              <div style={{ height: 8, background: "var(--bg-soft)", border: "1px solid var(--ink)", borderRadius: 999, overflow: "hidden" }}>
                <div style={{ width: `${d.pct}%`, height: "100%", background: d.c }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>

    <nav style={{
      position: "absolute", bottom: 0, left: 0, right: 0,
      borderTop: "1.5px solid var(--ink)",
      background: "var(--bg-soft)",
      display: "grid", gridTemplateColumns: "repeat(4, 1fr)",
      padding: "8px 0 22px",
    }}>
      {[
        { i: <SketchBook size={22} />, l: "decks" },
        { i: <SketchCardStack size={22} />, l: "browse" },
        { i: <SketchPlus />, l: "add" },
        { i: <SketchCalendar size={22} />, l: "stats", on: true },
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

Object.assign(window, { StatsV1, StatsMobile });
