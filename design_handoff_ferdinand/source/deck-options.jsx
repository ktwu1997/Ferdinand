/* Deck options — per-deck settings: FSRS params, daily limits, learning steps, display.
   This is the screen you reach from the deck list (gear icon) or from study setup.
   Most-edited screen during a power-user's setup.
*/

const DeckOptHeader = ({ name, glyph, onMobile }) => (
  <div style={{
    display: "flex", alignItems: "center", gap: 14,
    padding: onMobile ? "0 0 14px" : "0 0 18px",
    borderBottom: "1px dashed var(--rule)",
    marginBottom: onMobile ? 18 : 24,
  }}>
    <span style={{
      width: onMobile ? 38 : 48, height: onMobile ? 38 : 48,
      display: "grid", placeItems: "center",
      border: "1.5px solid var(--ink)", borderRadius: 4,
      background: "var(--accent-soft)",
      fontFamily: '"JetBrains Mono", monospace',
      fontSize: onMobile ? 12 : 15, fontWeight: 600,
      color: "var(--ink)",
      boxShadow: "2px 2px 0 var(--ink)",
    }}>{glyph}</span>
    <div style={{ flex: 1 }}>
      <Caption>// editing</Caption>
      <div style={{
        fontFamily: 'var(--font-cjk)',
        fontSize: onMobile ? 18 : 22, fontWeight: 600, marginTop: 2,
        letterSpacing: "-0.01em",
      }}>{name}</div>
    </div>
    {!onMobile && (
      <div className="mono" style={{ fontSize: 11, color: "var(--ink-mute)", textAlign: "right" }}>
        2,340 cards · 1,820 mature<br/>
        <span style={{ color: "var(--accent)" }}>preset · default</span>
      </div>
    )}
  </div>
);

const Group = ({ title, hint, children }) => (
  <section style={{ marginBottom: 28 }}>
    <div style={{ marginBottom: 14 }}>
      <Caption>// {title}</Caption>
      {hint && <div style={{ fontSize: 11, color: "var(--ink-mute)", marginTop: 4, lineHeight: 1.55 }}>{hint}</div>}
    </div>
    <div style={{ display: "flex", flexDirection: "column" }}>{children}</div>
  </section>
);

const Row = ({ k, hint, children, last }) => (
  <div style={{
    display: "grid", gridTemplateColumns: "180px 1fr", gap: 24, alignItems: "flex-start",
    padding: "14px 0",
    borderBottom: last ? "none" : "1px solid var(--rule-soft)",
  }}>
    <div>
      <div className="mono" style={{ fontSize: 12, fontWeight: 500, letterSpacing: "0.02em" }}>{k}</div>
      {hint && <div style={{ fontSize: 10, color: "var(--ink-mute)", marginTop: 4, lineHeight: 1.5 }}>{hint}</div>}
    </div>
    <div>{children}</div>
  </div>
);

/* Stepper for numeric inputs */
const Stepper = ({ value, suffix, w = 130 }) => (
  <div style={{
    display: "inline-flex", alignItems: "stretch", width: w,
    border: "1.4px solid var(--ink)", borderRadius: 4,
    background: "var(--paper)", boxShadow: "2px 2px 0 var(--ink)",
    overflow: "hidden",
  }}>
    <button style={{
      width: 28, border: "none", borderRight: "1.2px solid var(--ink)",
      background: "var(--bg-soft)", fontFamily: '"JetBrains Mono", monospace',
      fontSize: 14, color: "var(--ink-soft)", cursor: "pointer",
    }}>−</button>
    <div style={{
      flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
      fontFamily: '"JetBrains Mono", monospace', fontSize: 13, fontWeight: 500,
    }}>
      {value}<span style={{ fontSize: 10, color: "var(--ink-mute)", fontWeight: 400 }}>{suffix}</span>
    </div>
    <button style={{
      width: 28, border: "none", borderLeft: "1.2px solid var(--ink)",
      background: "var(--bg-soft)", fontFamily: '"JetBrains Mono", monospace',
      fontSize: 14, color: "var(--ink-soft)", cursor: "pointer",
    }}>+</button>
  </div>
);

/* Slider for retention target */
const RetentionSlider = ({ value = 0.9 }) => {
  const min = 0.7, max = 0.97;
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 460 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span className="mono" style={{ fontSize: 11, color: "var(--ink-mute)" }}>70%</span>
        <span className="mono" style={{
          fontSize: 22, fontWeight: 600, color: "var(--accent)",
          letterSpacing: "-0.02em",
        }}>{Math.round(value * 100)}<span style={{ fontSize: 12, color: "var(--ink-mute)", fontWeight: 400, marginLeft: 2 }}>%</span></span>
        <span className="mono" style={{ fontSize: 11, color: "var(--ink-mute)" }}>97%</span>
      </div>
      <div style={{
        position: "relative", height: 16,
        border: "1.4px solid var(--ink)", borderRadius: 999,
        background: "var(--paper)", boxShadow: "inset 1px 1px 0 var(--rule-soft)",
        overflow: "hidden",
      }}>
        <div style={{
          position: "absolute", top: 0, left: 0, height: "100%", width: `${pct}%`,
          background: "var(--accent)",
        }} />
        {/* sweet spot marker at 90% */}
        <div style={{
          position: "absolute", top: -4, bottom: -4,
          left: `${((0.9 - min) / (max - min)) * 100}%`,
          width: 0, borderLeft: "1.5px dashed var(--ink)",
        }} />
      </div>
      <div className="mono" style={{ fontSize: 10, color: "var(--ink-mute)", display: "flex", justifyContent: "space-between" }}>
        <span>↑ retain less, study less</span>
        <span style={{ color: "var(--accent)" }}>· 90% sweet spot</span>
        <span>retain more, study more ↑</span>
      </div>
    </div>
  );
};

/* Learning steps editor — chips that look like timeline */
const LearningSteps = ({ steps = ["1m", "10m", "1d"] }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
    {steps.map((s, i) => (
      <React.Fragment key={i}>
        <span style={{
          padding: "8px 14px",
          fontFamily: '"JetBrains Mono", monospace', fontSize: 12, fontWeight: 500,
          border: "1.4px solid var(--ink)", borderRadius: 4,
          background: "var(--paper)", boxShadow: "2px 2px 0 var(--ink)",
          display: "flex", alignItems: "center", gap: 6,
        }}>
          {s}
          <span style={{ color: "var(--ink-mute)", fontSize: 10, cursor: "pointer" }}>×</span>
        </span>
        {i < steps.length - 1 && <span className="mono" style={{ color: "var(--ink-mute)", fontSize: 14 }}>→</span>}
      </React.Fragment>
    ))}
    <span className="mono" style={{
      padding: "8px 12px", fontSize: 12,
      border: "1.4px dashed var(--ink-mute)", borderRadius: 4,
      color: "var(--ink-mute)", cursor: "pointer",
    }}>+ step</span>
  </div>
);

/* Preset selector — large segmented chips */
const PresetSelect = ({ selected = "default" }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 540 }}>
    <div style={{ display: "flex", gap: 8 }}>
      {[
        { id: "default", n: "default", d: "balanced · 90% retention" },
        { id: "aggressive", n: "aggressive", d: "95% · slower growth" },
        { id: "fast", n: "fast", d: "85% · learn more" },
        { id: "custom", n: "custom", d: "this deck only" },
      ].map(p => {
        const on = p.id === selected;
        return (
          <div key={p.id} style={{
            flex: 1, padding: "12px 14px",
            border: `1.4px solid var(--ink)`, borderRadius: 4,
            background: on ? "var(--accent-soft)" : "var(--paper)",
            boxShadow: on ? "2px 2px 0 var(--ink)" : "none",
            cursor: "pointer",
          }}>
            <div className="mono" style={{
              fontSize: 12, fontWeight: 600,
              color: on ? "var(--accent)" : "var(--ink)",
              letterSpacing: "0.02em",
            }}>{p.n}</div>
            <div style={{ fontSize: 10, color: "var(--ink-mute)", marginTop: 2 }}>{p.d}</div>
          </div>
        );
      })}
    </div>
    <div className="mono" style={{ fontSize: 10, color: "var(--ink-mute)" }}>
      preset applies to <span style={{ color: "var(--ink-soft)" }}>5 decks</span> · changes here propagate
    </div>
  </div>
);

/* The full screen — desktop */
const DeckOptionsV1 = ({ width = 1280, height = 1080 }) => (
  <div className="theme grain" style={{ width, height, display: "flex", overflow: "hidden" }}>
    <NavRail />
    <main style={{ flex: 1, display: "flex", overflow: "hidden" }}>
      {/* deck list mini-sidebar — for context */}
      <aside style={{
        width: 240, padding: "32px 18px 24px",
        borderRight: "1.5px solid var(--ink)",
        background: "var(--bg-soft)",
        flexShrink: 0,
        display: "flex", flexDirection: "column", gap: 14,
      }}>
        <div>
          <Caption>// decks</Caption>
          <div className="mono" style={{ fontSize: 11, color: "var(--ink-mute)", marginTop: 4 }}>5 active</div>
        </div>
        {[
          { g: "JP", n: "日文 N2", on: true, c: 2340 },
          { g: "RS", n: "Rust ownership", c: 412 },
          { g: "HX", n: "World History", c: 890 },
          { g: "AN", n: "Anatomy", c: 1567 },
          { g: "PT", n: "Piano theory", c: 203 },
        ].map(d => (
          <div key={d.n} style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "8px 10px", borderRadius: 4,
            background: d.on ? "var(--paper)" : "transparent",
            border: d.on ? "1.2px solid var(--ink)" : "1.2px solid transparent",
            boxShadow: d.on ? "2px 2px 0 var(--ink)" : "none",
            cursor: "pointer",
          }}>
            <span style={{
              width: 24, height: 24, display: "grid", placeItems: "center",
              border: "1.2px solid var(--ink)", borderRadius: 3,
              fontFamily: '"JetBrains Mono", monospace', fontSize: 9, fontWeight: 600,
              background: d.on ? "var(--accent-soft)" : "var(--bg)",
            }}>{d.g}</span>
            <span className="mono" style={{
              fontSize: 12, fontWeight: d.on ? 500 : 400,
              color: d.on ? "var(--ink)" : "var(--ink-soft)",
              flex: 1,
            }}>{d.n}</span>
            <span className="mono" style={{ fontSize: 9, color: "var(--ink-mute)" }}>{d.c}</span>
          </div>
        ))}
        <div style={{ marginTop: "auto", borderTop: "1px dashed var(--rule)", paddingTop: 14 }}>
          <Btn kind="paper" size="sm" leading={<SketchPlus size={12} />} style={{ width: "100%", justifyContent: "center" }}>
            new deck
          </Btn>
        </div>
      </aside>

      {/* main pane */}
      <div style={{ flex: 1, padding: "32px 48px", overflow: "auto" }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 22 }}>
          <div>
            <Caption>// deck.options</Caption>
            <h2 style={{
              fontFamily: '"JetBrains Mono", monospace',
              fontSize: 26, fontWeight: 600, margin: "6px 0 4px", letterSpacing: "-0.02em",
            }}>deck options
              <span className="hand" style={{ color: "var(--accent)", fontSize: 22, marginLeft: 12 }}>tune the schedule</span>
            </h2>
            <div style={{ fontSize: 13, color: "var(--ink-soft)", maxWidth: 540 }}>
              FSRS adapts intervals per card. These knobs set the targets and limits — the algorithm does the rest.
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Btn kind="ghost" size="sm">discard</Btn>
            <Btn kind="paper" size="sm">duplicate preset</Btn>
            <Btn kind="primary" size="sm">save</Btn>
          </div>
        </header>

        <DeckOptHeader name="日文 N2" glyph="JP" />

        <Group title="preset" hint="Pick a starting point — or 'custom' to detach this deck from any preset.">
          <PresetSelect selected="default" />
        </Group>

        <Group title="daily limits" hint="Caps applied per day. New cards drain into reviews after the first 'good'.">
          <Row k="new cards / day" hint="Cards introduced from the queue.">
            <Stepper value="20" suffix="cards" />
          </Row>
          <Row k="max reviews / day" hint="Upper bound on review burden if you fall behind.">
            <Stepper value="200" suffix="cards" />
          </Row>
          <Row k="new cards order" hint="How cards from the new queue are pulled.">
            <RadioRow options={["sequential", "random", "random in deck"]} selected="sequential" />
          </Row>
          <Row k="show new cards" last hint="Mix into reviews, or finish reviews first.">
            <RadioRow options={["mixed with reviews", "after reviews", "before reviews"]} selected="mixed with reviews" />
          </Row>
        </Group>

        <Group title="FSRS · scheduling" hint="The retention target is the lever you'll touch most. 90% is the well-known sweet spot for total study time.">
          <Row k="desired retention" hint="Probability you want to recall a card on its due date.">
            <RetentionSlider value={0.9} />
          </Row>
          <Row k="max interval" hint="Hard cap on how far in the future a card can be scheduled.">
            <Stepper value="36500" suffix="d" w={150} />
          </Row>
          <Row k="hard interval" hint="Multiplier when you press 'hard'.">
            <Stepper value="1.2" suffix="×" />
          </Row>
          <Row k="easy bonus" last hint="Multiplier when you press 'easy'.">
            <Stepper value="1.3" suffix="×" />
          </Row>
        </Group>

        <Group title="learning steps" hint="The path a brand-new card takes before graduating to the FSRS schedule.">
          <Row k="learning" hint="Steps shown when learning a new card.">
            <LearningSteps steps={["1m", "10m", "1d"]} />
          </Row>
          <Row k="relearning" last hint="Steps when a card lapses (you press 'again' on a mature card).">
            <LearningSteps steps={["10m", "1d"]} />
          </Row>
        </Group>

        <Group title="display & audio" hint="Surface options. Don't affect scheduling.">
          <Row k="show timer">
            <Toggle on label="show review timer" desc="Tracks per-card response time, used by FSRS." />
          </Row>
          <Row k="auto-play audio">
            <Toggle on label="play audio on front" />
          </Row>
          <Row k="answer keys">
            <Toggle on label="enable 1/2/3/4 hotkeys" desc="again / hard / good / easy." />
          </Row>
          <Row k="bury siblings" last>
            <Toggle label="bury related cards until tomorrow" desc="For card types with multiple templates." />
          </Row>
        </Group>

        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          marginTop: 14, padding: "16px 18px",
          background: "var(--bg-soft)",
          border: "1px dashed var(--due)", borderRadius: 4,
        }}>
          <div>
            <Caption style={{ color: "var(--due)" }}>// danger zone</Caption>
            <div className="mono" style={{ fontSize: 13, fontWeight: 500, marginTop: 4 }}>delete deck</div>
            <div style={{ fontSize: 11, color: "var(--ink-mute)", marginTop: 2 }}>2,340 cards · all review history will be lost.</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Btn kind="outline" size="sm">empty deck (keep cards)</Btn>
            <Btn kind="outline" size="sm" style={{ borderColor: "var(--due)", color: "var(--due)" }}>delete deck</Btn>
          </div>
        </div>
      </div>
    </main>
  </div>
);

/* New-deck modal — much shorter */
const NewDeckModal = ({ width = 720, height = 600 }) => (
  <div className="theme grain" style={{
    width, height,
    background: "color-mix(in oklch, var(--ink) 50%, transparent)",
    display: "grid", placeItems: "center",
    padding: 32,
  }}>
    <div style={{
      width: 520, padding: "30px 32px",
      background: "var(--paper)",
      border: "1.5px solid var(--ink)", borderRadius: 6,
      boxShadow: "5px 5px 0 var(--ink)",
      display: "flex", flexDirection: "column", gap: 18,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <Caption>// new.deck</Caption>
          <div style={{
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: 22, fontWeight: 600, marginTop: 4, letterSpacing: "-0.02em",
          }}>create deck</div>
        </div>
        <span className="mono" style={{ fontSize: 16, color: "var(--ink-mute)", cursor: "pointer" }}>×</span>
      </div>

      <div>
        <Caption style={{ marginBottom: 6 }}>// name</Caption>
        <div style={{
          padding: "12px 14px",
          border: "1.4px solid var(--ink)", borderRadius: 4,
          background: "var(--paper)", boxShadow: "2px 2px 0 var(--ink)",
          fontFamily: 'var(--font-cjk)',
          fontSize: 18, fontWeight: 500,
        }}>德文 A1
          <span className="mono" style={{ color: "var(--ink-mute)", fontSize: 12, marginLeft: 6 }}>|</span>
        </div>
      </div>

      <div>
        <Caption style={{ marginBottom: 6 }}>// glyph (2 chars)</Caption>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{
            width: 48, height: 48, display: "grid", placeItems: "center",
            border: "1.5px solid var(--ink)", borderRadius: 4,
            background: "var(--accent-soft)",
            fontFamily: '"JetBrains Mono", monospace', fontSize: 15, fontWeight: 600,
            boxShadow: "2px 2px 0 var(--ink)",
          }}>DE</div>
          <span className="mono" style={{ fontSize: 11, color: "var(--ink-mute)" }}>auto-derived from name · click to edit</span>
        </div>
      </div>

      <div>
        <Caption style={{ marginBottom: 6 }}>// preset</Caption>
        <RadioRow options={["default", "aggressive", "fast", "custom later"]} selected="default" />
      </div>

      <div>
        <Caption style={{ marginBottom: 6 }}>// parent (optional)</Caption>
        <div style={{
          padding: "9px 12px",
          border: "1.4px solid var(--ink)", borderRadius: 4,
          background: "var(--paper)",
          fontFamily: '"JetBrains Mono", monospace', fontSize: 12,
          color: "var(--ink-mute)",
          display: "flex", justifyContent: "space-between",
        }}>
          <span>— top level —</span>
          <span>▾</span>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
        <Btn kind="ghost" size="sm">cancel</Btn>
        <Btn kind="paper" size="sm">create & open options</Btn>
        <Btn kind="primary" size="sm" leading={<SketchPlus size={12} />}>create</Btn>
      </div>
    </div>
  </div>
);

/* Mobile — same content, single column, condensed */
const DeckOptionsMobile = ({ width = 390, height = 1280 }) => (
  <div className="theme grain" style={{ width, height, position: "relative", overflow: "hidden", display: "flex", flexDirection: "column" }}>
    <header style={{
      padding: "48px 22px 14px",
      borderBottom: "1.5px solid var(--ink)",
      display: "flex", justifyContent: "space-between", alignItems: "center",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Btn kind="ghost" size="sm" style={{ padding: "4px 4px" }}>←</Btn>
        <div>
          <Caption>// deck options</Caption>
          <div className="mono" style={{ fontSize: 13, fontWeight: 500 }}>日文 N2</div>
        </div>
      </div>
      <Btn kind="primary" size="sm">save</Btn>
    </header>

    <main style={{ flex: 1, overflow: "auto", padding: "16px 22px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <Caption style={{ marginBottom: 8 }}>// preset</Caption>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          {["default", "aggressive", "fast", "custom"].map((p, i) => (
            <span key={p} className="mono" style={{
              padding: "10px 12px", fontSize: 11, fontWeight: 600,
              border: "1.2px solid var(--ink)", borderRadius: 4,
              background: i === 0 ? "var(--accent-soft)" : "var(--paper)",
              color: i === 0 ? "var(--accent)" : "var(--ink-soft)",
              boxShadow: i === 0 ? "2px 2px 0 var(--ink)" : "none",
              textAlign: "center",
            }}>{p}</span>
          ))}
        </div>
      </div>

      <div style={{
        background: "var(--paper)", border: "1.4px solid var(--ink)",
        borderRadius: 4, padding: "14px 16px", boxShadow: "2px 2px 0 var(--ink)",
      }}>
        <Caption>// retention target</Caption>
        <div style={{ marginTop: 12 }}>
          <RetentionSlider value={0.9} />
        </div>
      </div>

      <div>
        <Caption style={{ marginBottom: 8 }}>// daily limits</Caption>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div className="mono" style={{ fontSize: 12, fontWeight: 500 }}>new / day</div>
              <div style={{ fontSize: 10, color: "var(--ink-mute)" }}>cards introduced</div>
            </div>
            <Stepper value="20" suffix="" />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div className="mono" style={{ fontSize: 12, fontWeight: 500 }}>max reviews</div>
              <div style={{ fontSize: 10, color: "var(--ink-mute)" }}>per day cap</div>
            </div>
            <Stepper value="200" suffix="" />
          </div>
        </div>
      </div>

      <div>
        <Caption style={{ marginBottom: 8 }}>// learning steps</Caption>
        <LearningSteps steps={["1m", "10m", "1d"]} />
      </div>

      <div>
        <Caption style={{ marginBottom: 8 }}>// display</Caption>
        <div style={{
          background: "var(--paper)", border: "1.4px solid var(--ink)",
          borderRadius: 4, padding: "14px 16px", boxShadow: "2px 2px 0 var(--ink)",
          display: "flex", flexDirection: "column", gap: 14,
        }}>
          <Toggle on label="show review timer" />
          <Toggle on label="play audio on front" />
          <Toggle on label="1/2/3/4 hotkeys" />
        </div>
      </div>

      <div style={{
        padding: "12px 14px",
        border: "1px dashed var(--due)", borderRadius: 4,
        background: "var(--bg-soft)",
        display: "flex", justifyContent: "space-between", alignItems: "center",
      }}>
        <div>
          <div className="mono" style={{ fontSize: 12, fontWeight: 500 }}>delete</div>
          <div style={{ fontSize: 10, color: "var(--ink-mute)" }}>2,340 cards lost</div>
        </div>
        <Btn kind="outline" size="sm" style={{ borderColor: "var(--due)", color: "var(--due)" }}>delete</Btn>
      </div>
    </main>
  </div>
);

Object.assign(window, { DeckOptionsV1, DeckOptionsMobile, NewDeckModal });
