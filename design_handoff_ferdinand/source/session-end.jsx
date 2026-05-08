/* Study session — END / summary screen.
   Reached when the queue empties. Should feel earned: numbers + visual reward.
   Three faces of the same screen across artboards.
*/

const RingProgress = ({ pct = 0.92, size = 140, label, sub, accent = "var(--accent)" }) => {
  const r = (size - 16) / 2;
  const c = 2 * Math.PI * r;
  const dash = c * pct;
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden="true">
      <circle cx={size/2} cy={size/2} r={r}
        stroke="var(--rule)" strokeWidth="3" fill="var(--paper)" />
      <circle cx={size/2} cy={size/2} r={r}
        stroke={accent} strokeWidth="6" fill="none"
        strokeLinecap="round"
        strokeDasharray={`${dash} ${c}`}
        transform={`rotate(-90 ${size/2} ${size/2})`} />
      <text x={size/2} y={size/2 - 4} textAnchor="middle"
        fontFamily="JetBrains Mono" fontSize="26" fontWeight="600"
        fill="var(--ink)">{label}</text>
      <text x={size/2} y={size/2 + 16} textAnchor="middle"
        fontFamily="JetBrains Mono" fontSize="10"
        letterSpacing="0.1em"
        fill="var(--ink-mute)">{sub}</text>
    </svg>
  );
};

/* Stamp graphic — looks like a rubber stamp */
const Stamp = ({ text = "DONE", angle = -8 }) => (
  <div style={{
    position: "absolute", top: 22, right: 28,
    transform: `rotate(${angle}deg)`,
    border: "2.5px solid var(--accent)",
    color: "var(--accent)",
    padding: "5px 14px",
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: 14, fontWeight: 700, letterSpacing: "0.18em",
    background: "color-mix(in oklch, var(--accent) 8%, transparent)",
    borderRadius: 3,
    opacity: 0.9,
    pointerEvents: "none",
  }}>
    <div style={{ borderTop: "1.5px solid var(--accent)", borderBottom: "1.5px solid var(--accent)", padding: "2px 0" }}>
      {text}
    </div>
  </div>
);

/* Bar showing answer mix for this session */
const SessionAnswerMix = () => {
  const data = [
    { l: "again", v: 4,  c: "var(--due)" },
    { l: "hard",  v: 7,  c: "var(--warn)" },
    { l: "good",  v: 28, c: "var(--accent)" },
    { l: "easy",  v: 6,  c: "var(--easy, #4a6c8e)" },
  ];
  const total = data.reduce((s, d) => s + d.v, 0);
  return (
    <div>
      <div style={{
        display: "flex", height: 22,
        border: "1.4px solid var(--ink)", borderRadius: 4,
        overflow: "hidden", boxShadow: "2px 2px 0 var(--ink)",
      }}>
        {data.map((d, i) => (
          <div key={d.l} style={{
            width: `${(d.v / total) * 100}%`, background: d.c,
            borderRight: i === data.length - 1 ? "none" : "1.4px solid var(--ink)",
          }} />
        ))}
      </div>
      <div style={{
        display: "flex", justifyContent: "space-between",
        marginTop: 8, fontFamily: '"JetBrains Mono", monospace', fontSize: 11,
      }}>
        {data.map(d => (
          <div key={d.l} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
            <span style={{
              width: 7, height: 7, background: d.c,
              border: "1px solid var(--ink)", borderRadius: 2,
            }} />
            <span style={{ color: d.c, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em" }}>{d.l}</span>
            <span style={{ color: "var(--ink-mute)" }}>{d.v}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

const SAMPLE_LEARNED = [
  { f: "懐かしい", b: "nostalgic", note: "first 'good'" },
  { f: "曖昧", b: "ambiguous, vague" },
  { f: "派手", b: "flashy, showy" },
  { f: "詫びる", b: "to apologize" },
  { f: "貫く", b: "to pierce, persist" },
];

/* Hero session-end card */
const SessionEndCard = ({ width = 720 }) => (
  <div style={{
    width, padding: "32px 36px",
    background: "var(--paper)",
    border: "1.5px solid var(--ink)", borderRadius: 6,
    boxShadow: "5px 5px 0 var(--ink)",
    position: "relative",
  }}>
    <Stamp text="DONE · APR 28" />
    <Caption>// session.complete</Caption>
    <h1 style={{
      fontFamily: '"JetBrains Mono", monospace',
      fontSize: 30, fontWeight: 600, margin: "6px 0 4px",
      letterSpacing: "-0.02em",
    }}>queue cleared
      <span className="hand" style={{ color: "var(--accent)", fontSize: 24, marginLeft: 12 }}>see you tomorrow</span>
    </h1>
    <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>
      日文 N2 · 45 cards reviewed · 18m 42s
    </div>

    <div style={{
      display: "flex", alignItems: "center", gap: 28,
      marginTop: 28, paddingTop: 24,
      borderTop: "1px dashed var(--rule)",
    }}>
      <RingProgress pct={0.93} label="93%" sub="RETAINED" />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 12 }}>
        <div>
          <Caption>// answers</Caption>
          <div style={{ marginTop: 8 }}>
            <SessionAnswerMix />
          </div>
        </div>
      </div>
    </div>

    <div style={{
      marginTop: 24, paddingTop: 20, borderTop: "1px dashed var(--rule)",
      display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16,
    }}>
      {[
        { l: "streak", v: "15", u: "days", hl: true },
        { l: "avg time", v: "24.9", u: "s / card" },
        { l: "fastest", v: "1.8", u: "s · 派手" },
        { l: "next due", v: "tomorrow", u: "07:00" },
      ].map(s => (
        <div key={s.l}>
          <Caption>// {s.l}</Caption>
          <div className="mono" style={{
            fontSize: 22, fontWeight: 600, marginTop: 4,
            color: s.hl ? "var(--accent)" : "var(--ink)",
            letterSpacing: "-0.02em",
          }}>{s.v}<span style={{ fontSize: 10, color: "var(--ink-mute)", fontWeight: 400, marginLeft: 4 }}>{s.u}</span></div>
        </div>
      ))}
    </div>
  </div>
);

/* New cards learned this session — list */
const LearnedList = ({ width = 480 }) => (
  <div style={{
    width, padding: "24px 26px",
    background: "var(--paper)",
    border: "1.5px solid var(--ink)", borderRadius: 6,
    boxShadow: "3px 3px 0 var(--ink)",
  }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
      <Caption>// new · learned today</Caption>
      <span className="mono" style={{ fontSize: 11, color: "var(--ink-mute)" }}>5 cards</span>
    </div>
    <div style={{ marginTop: 14, display: "flex", flexDirection: "column" }}>
      {SAMPLE_LEARNED.map((c, i) => (
        <div key={i} style={{
          display: "grid", gridTemplateColumns: "100px 1fr auto", gap: 14, alignItems: "baseline",
          padding: "10px 0",
          borderBottom: i === SAMPLE_LEARNED.length - 1 ? "none" : "1px dashed var(--rule)",
        }}>
          <div style={{
            fontFamily: 'var(--font-cjk)',
            fontSize: 18, fontWeight: 500,
          }}>{c.f}</div>
          <div className="mono" style={{ fontSize: 12, color: "var(--ink-soft)" }}>{c.b}</div>
          <span className="mono" style={{ fontSize: 10, color: "var(--ink-mute)", letterSpacing: "0.06em" }}>
            {c.note || "→ 1d"}
          </span>
        </div>
      ))}
    </div>
    <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--rule-soft)" }}>
      <Caption>// next session preview</Caption>
      <div style={{
        marginTop: 8, display: "flex", gap: 10,
        fontFamily: '"JetBrains Mono", monospace', fontSize: 12,
      }}>
        <span><span style={{ color: "var(--accent)" }}>●</span> 18 due</span>
        <span style={{ color: "var(--ink-mute)" }}>·</span>
        <span><span style={{ color: "var(--warn)" }}>●</span> 5 learning</span>
        <span style={{ color: "var(--ink-mute)" }}>·</span>
        <span><span style={{ color: "var(--ink-soft)" }}>●</span> 20 new</span>
      </div>
    </div>
  </div>
);

/* Heatmap row — last 14 days, today filled */
const StreakStrip = () => {
  const days = Array.from({ length: 14 }, (_, i) => {
    const seed = (i * 7919 + 31) % 233280;
    const v = (seed / 233280);
    return v > 0.15 ? Math.min(4, Math.floor(v * 5) + 1) : 0;
  });
  days[days.length - 1] = 4; // today
  const colors = [
    "var(--paper)",
    "color-mix(in oklch, var(--accent) 18%, var(--paper))",
    "color-mix(in oklch, var(--accent) 38%, var(--paper))",
    "color-mix(in oklch, var(--accent) 65%, var(--paper))",
    "var(--accent)",
  ];
  return (
    <div style={{
      padding: "16px 22px",
      background: "var(--bg-soft)",
      border: "1px dashed var(--rule)", borderRadius: 6,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
        <Caption>// 14-day streak</Caption>
        <span className="mono" style={{ fontSize: 11 }}>
          <span style={{ color: "var(--accent)" }}>+1 → </span>
          <span style={{ color: "var(--ink)" }}>15 days</span>
        </span>
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "flex-end" }}>
        {days.map((d, i) => {
          const isToday = i === days.length - 1;
          return (
            <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
              <div style={{
                width: 22, height: 22,
                background: colors[d],
                border: isToday ? "1.8px solid var(--accent)" : "1px solid var(--ink)",
                borderRadius: 3,
                boxShadow: isToday ? "0 0 0 3px color-mix(in oklch, var(--accent) 22%, transparent)" : "none",
              }} />
              {isToday && <span className="mono" style={{ fontSize: 9, color: "var(--accent)", fontWeight: 500 }}>today</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
};

/* Full screen — desktop */
const SessionEndV1 = ({ width = 1280, height = 880 }) => (
  <div className="theme grain" style={{
    width, height, padding: "48px 64px",
    overflow: "hidden",
    display: "flex", flexDirection: "column", gap: 28,
  }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
      <div>
        <Caption>// the.bell</Caption>
        <div style={{
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: 13, color: "var(--ink-mute)", marginTop: 4,
        }}>thursday · 28 apr · 09:42</div>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <Btn kind="ghost" size="sm">share</Btn>
        <Btn kind="paper" size="sm">study another deck</Btn>
        <Btn kind="primary" size="sm">back to dashboard</Btn>
      </div>
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "720px 1fr", gap: 28, flex: 1, minHeight: 0 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
        <SessionEndCard width="100%" />
        <StreakStrip />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
        <LearnedList width="100%" />
        <div style={{
          padding: "20px 22px",
          background: "var(--paper)",
          border: "1.5px solid var(--ink)", borderRadius: 6,
          boxShadow: "3px 3px 0 var(--ink)",
        }}>
          <Caption>// remaining today</Caption>
          <div className="mono" style={{
            fontSize: 28, fontWeight: 600, marginTop: 6,
            letterSpacing: "-0.02em", color: "var(--accent)",
          }}>everything done</div>
          <div style={{ fontSize: 13, color: "var(--ink-soft)", marginTop: 6 }}>
            All 5 decks have an empty queue today. Optional: study ahead from <span className="mono" style={{ color: "var(--ink)" }}>Anatomy</span> (38 cards due tomorrow).
          </div>
          <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
            <Btn kind="paper" size="sm" leading={<SketchSpark size={12} />}>study ahead</Btn>
            <Btn kind="ghost" size="sm">cram a deck</Btn>
          </div>
        </div>
      </div>
    </div>
  </div>
);

/* Compact variant — overlay/modal feel */
const SessionEndCompact = ({ width = 1280, height = 880 }) => (
  <div className="theme grain" style={{
    width, height,
    background: "var(--bg-deep)",
    display: "grid", placeItems: "center",
    padding: 48,
    position: "relative",
  }}>
    {/* faint background grid of just-reviewed cards */}
    <div style={{
      position: "absolute", inset: 0, padding: 60,
      display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gridTemplateRows: "repeat(4, 1fr)",
      gap: 18, opacity: 0.35, pointerEvents: "none",
    }}>
      {Array.from({ length: 24 }).map((_, i) => (
        <div key={i} style={{
          background: "var(--paper)",
          border: "1px solid var(--ink)", borderRadius: 4,
          transform: `rotate(${(i % 3 - 1) * 0.6}deg) translateY(${(i * 7) % 9}px)`,
          fontFamily: 'var(--font-cjk)',
          fontSize: 18,
          padding: 14,
          color: "var(--ink-soft)",
        }}>{["懐かしい","曖昧","派手","詫びる","貫く","染まる","怠ける","気配","拘る","捗る","培う","賄う"][i % 12]}</div>
      ))}
    </div>

    <div style={{
      position: "relative",
      width: 600, padding: "44px 48px",
      background: "var(--paper)",
      border: "1.5px solid var(--ink)", borderRadius: 6,
      boxShadow: "8px 8px 0 var(--ink)",
      textAlign: "center",
    }}>
      <Stamp text="EMPTY · 09:42" angle={-6} />

      <Caption>// session.complete</Caption>
      <div style={{
        fontFamily: 'var(--font-cjk)',
        fontSize: 64, fontWeight: 600,
        marginTop: 14, lineHeight: 1.05,
        letterSpacing: "-0.02em",
      }}>學習完成</div>
      <div className="hand" style={{ color: "var(--accent)", fontSize: 26, marginTop: 4 }}>
        — queue cleared, see you tomorrow
      </div>

      <div style={{
        margin: "30px auto 0",
        display: "grid", gridTemplateColumns: "1fr 1fr 1fr",
        gap: 0,
        borderTop: "1px dashed var(--rule)",
        borderBottom: "1px dashed var(--rule)",
        paddingTop: 20, paddingBottom: 20,
      }}>
        {[
          { l: "reviewed", v: "45", u: "cards" },
          { l: "retention", v: "93%", u: "this round", hl: true },
          { l: "streak", v: "+1 → 15d", u: "days", hl: true },
        ].map((s, i) => (
          <div key={s.l} style={{
            borderRight: i < 2 ? "1px dashed var(--rule)" : "none",
            display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
          }}>
            <Caption>// {s.l}</Caption>
            <div className="mono" style={{
              fontSize: 26, fontWeight: 600, color: s.hl ? "var(--accent)" : "var(--ink)",
              letterSpacing: "-0.02em",
            }}>{s.v}</div>
            <span className="mono" style={{ fontSize: 10, color: "var(--ink-mute)" }}>{s.u}</span>
          </div>
        ))}
      </div>

      <div style={{
        marginTop: 20, display: "flex", gap: 10, justifyContent: "center",
      }}>
        <Btn kind="paper" size="sm">undo last</Btn>
        <Btn kind="primary" size="sm">back to dashboard <span className="mono" style={{ fontSize: 10, opacity: 0.7, marginLeft: 6 }}>↵</span></Btn>
      </div>

      <div className="mono" style={{
        marginTop: 16, fontSize: 10, color: "var(--ink-mute)",
        letterSpacing: "0.08em",
      }}>next due · tomorrow 07:00 · 38 cards</div>
    </div>
  </div>
);

/* Mobile */
const SessionEndMobile = ({ width = 390, height = 844 }) => (
  <div className="theme grain" style={{
    width, height, position: "relative", overflow: "hidden",
    display: "flex", flexDirection: "column",
  }}>
    <div style={{
      padding: "60px 22px 18px",
      borderBottom: "1.5px solid var(--ink)",
      background: "var(--bg-soft)",
      position: "relative",
    }}>
      <Stamp text="DONE · 09:42" angle={-7} />
      <Caption>// session complete</Caption>
      <div style={{
        fontFamily: 'var(--font-cjk)',
        fontSize: 32, fontWeight: 600,
        marginTop: 6, lineHeight: 1.1,
        letterSpacing: "-0.02em",
      }}>學習完成</div>
      <div className="hand" style={{ color: "var(--accent)", fontSize: 18, marginTop: -2 }}>
        — see you tomorrow
      </div>
      <div className="mono" style={{ fontSize: 11, color: "var(--ink-mute)", marginTop: 8 }}>
        日文 N2 · 45 cards · 18m 42s
      </div>
    </div>

    <main style={{ flex: 1, overflow: "auto", padding: "18px 22px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <RingProgress pct={0.93} label="93%" sub="RETAINED" size={110} />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
          {[
            { l: "streak", v: "+1 → 15d", hl: true },
            { l: "avg", v: "24.9s" },
            { l: "next", v: "tmrw 07:00" },
          ].map(s => (
            <div key={s.l} style={{
              display: "flex", justifyContent: "space-between", alignItems: "baseline",
              padding: "8px 12px",
              background: "var(--paper)",
              border: "1.2px solid var(--ink)", borderRadius: 4,
              boxShadow: "2px 2px 0 var(--ink)",
            }}>
              <span className="mono" style={{ fontSize: 10, color: "var(--ink-mute)", letterSpacing: "0.06em", textTransform: "uppercase" }}>{s.l}</span>
              <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: s.hl ? "var(--accent)" : "var(--ink)" }}>{s.v}</span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <Caption style={{ marginBottom: 8 }}>// answers</Caption>
        <SessionAnswerMix />
      </div>

      <div>
        <Caption style={{ marginBottom: 8 }}>// learned · 5 new</Caption>
        <div style={{
          background: "var(--paper)",
          border: "1.4px solid var(--ink)", borderRadius: 4,
          padding: "8px 14px",
          boxShadow: "2px 2px 0 var(--ink)",
        }}>
          {SAMPLE_LEARNED.map((c, i) => (
            <div key={i} style={{
              display: "flex", justifyContent: "space-between", alignItems: "baseline",
              padding: "8px 0",
              borderBottom: i === SAMPLE_LEARNED.length - 1 ? "none" : "1px dashed var(--rule)",
            }}>
              <span style={{ fontFamily: 'var(--font-cjk)', fontSize: 16, fontWeight: 500 }}>{c.f}</span>
              <span className="mono" style={{ fontSize: 11, color: "var(--ink-soft)" }}>{c.b}</span>
            </div>
          ))}
        </div>
      </div>

      <StreakStrip />
    </main>

    <div style={{
      borderTop: "1.5px solid var(--ink)",
      padding: "14px 22px 32px",
      background: "var(--bg-soft)",
      display: "flex", gap: 8,
    }}>
      <Btn kind="paper" size="sm" style={{ flex: 1, justifyContent: "center" }}>study ahead</Btn>
      <Btn kind="primary" size="sm" style={{ flex: 1, justifyContent: "center" }}>done</Btn>
    </div>
  </div>
);

Object.assign(window, { SessionEndV1, SessionEndCompact, SessionEndMobile });
