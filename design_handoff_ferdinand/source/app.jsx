/* Top-level wiring — design canvas + tweaks panel + theme override. */

const { useState, useEffect } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "themeOverride": "auto"
}/*EDITMODE-END*/;

/* Board wrapper applies theme attribute to scope CSS variables */
const Board = ({ theme, children }) => (
  <div data-theme={theme} className="theme" style={{ width: "100%", height: "100%" }}>
    {children}
  </div>
);

const App = () => {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [showTweaks, setShowTweaks] = useState(false);

  useEffect(() => {
    const onMsg = (e) => {
      const d = e.data || {};
      if (d.type === "__activate_edit_mode") setShowTweaks(true);
      else if (d.type === "__deactivate_edit_mode") setShowTweaks(false);
    };
    window.addEventListener("message", onMsg);
    window.parent.postMessage({ type: "__edit_mode_available" }, "*");
    return () => window.removeEventListener("message", onMsg);
  }, []);

  // theme override resolves per-artboard intent
  const resolveTheme = (intrinsic) => {
    if (t.themeOverride === "light") return "light";
    if (t.themeOverride === "dark") return "dark";
    return intrinsic;
  };

  return (
    <>
      <DesignCanvas title="Ferdinand UI · redesign">
        <DCSection id="type" title="00 — CJK type options" subtitle="挑一個中文/日文字型 · same content · 5 fonts">
          <DCArtboard id="type-light" label="comparison · light" width={1280} height={1640}>
            <Board theme={resolveTheme("light")}><TypeGrid /></Board>
          </DCArtboard>
          <DCArtboard id="type-dark" label="comparison · dark" width={1280} height={1640}>
            <Board theme={resolveTheme("dark")}><TypeGrid dark /></Board>
          </DCArtboard>
        </DCSection>

        <DCSection id="login" title="01 — Login" subtitle="self-hosted sync sign-in">
          <DCArtboard id="login-v1-light" label="split · light" width={1280} height={880}>
            <Board theme={resolveTheme("light")}><LoginV1 /></Board>
          </DCArtboard>
          <DCArtboard id="login-v1-dark" label="split · dark" width={1280} height={880}>
            <Board theme={resolveTheme("dark")}><LoginV1 /></Board>
          </DCArtboard>
          <DCArtboard id="login-mobile-light" label="mobile · light" width={390} height={844}>
            <Board theme={resolveTheme("light")}><LoginMobile /></Board>
          </DCArtboard>
          <DCArtboard id="login-mobile-dark" label="mobile · dark" width={390} height={844}>
            <Board theme={resolveTheme("dark")}><LoginMobile /></Board>
          </DCArtboard>
        </DCSection>

        <DCSection id="dashboard" title="02 — Dashboard" subtitle="deck list · today summary · streak">
          <DCArtboard id="dash-v1-light" label="ledger · light" width={1280} height={880}>
            <Board theme={resolveTheme("light")}><DashboardV1 /></Board>
          </DCArtboard>
          <DCArtboard id="dash-v1-dark" label="ledger · dark" width={1280} height={880}>
            <Board theme={resolveTheme("dark")}><DashboardV1 /></Board>
          </DCArtboard>
          <DCArtboard id="dash-mobile-light" label="mobile · light" width={390} height={844}>
            <Board theme={resolveTheme("light")}><DashboardMobile /></Board>
          </DCArtboard>
          <DCArtboard id="dash-mobile-dark" label="mobile · dark" width={390} height={844}>
            <Board theme={resolveTheme("dark")}><DashboardMobile /></Board>
          </DCArtboard>
        </DCSection>

        <DCSection id="study" title="03 — Study" subtitle="review session · front/back · FSRS answer buttons">
          <DCArtboard id="study-front-light" label="front · light" width={1280} height={880}>
            <Board theme={resolveTheme("light")}><StudyV1 revealed={false} /></Board>
          </DCArtboard>
          <DCArtboard id="study-back-light" label="answer revealed · light" width={1280} height={880}>
            <Board theme={resolveTheme("light")}><StudyV1 revealed={true} /></Board>
          </DCArtboard>
          <DCArtboard id="study-front-dark" label="front · dark" width={1280} height={880}>
            <Board theme={resolveTheme("dark")}><StudyV1 revealed={false} /></Board>
          </DCArtboard>
          <DCArtboard id="study-back-dark" label="answer revealed · dark" width={1280} height={880}>
            <Board theme={resolveTheme("dark")}><StudyV1 revealed={true} /></Board>
          </DCArtboard>
          <DCArtboard id="study-mobile-front-light" label="mobile · front · light" width={390} height={844}>
            <Board theme={resolveTheme("light")}><StudyMobile revealed={false} /></Board>
          </DCArtboard>
          <DCArtboard id="study-mobile-back-light" label="mobile · revealed · light" width={390} height={844}>
            <Board theme={resolveTheme("light")}><StudyMobile revealed={true} /></Board>
          </DCArtboard>
          <DCArtboard id="study-mobile-front-dark" label="mobile · front · dark" width={390} height={844}>
            <Board theme={resolveTheme("dark")}><StudyMobile revealed={false} /></Board>
          </DCArtboard>
          <DCArtboard id="study-mobile-back-dark" label="mobile · revealed · dark" width={390} height={844}>
            <Board theme={resolveTheme("dark")}><StudyMobile revealed={true} /></Board>
          </DCArtboard>
        </DCSection>

        <DCSection id="browse" title="04 — Browse" subtitle="card archive · search · filter · detail">
          <DCArtboard id="browse-light" label="three-pane · light" width={1280} height={880}>
            <Board theme={resolveTheme("light")}><BrowseV1 /></Board>
          </DCArtboard>
          <DCArtboard id="browse-dark" label="three-pane · dark" width={1280} height={880}>
            <Board theme={resolveTheme("dark")}><BrowseV1 /></Board>
          </DCArtboard>
          <DCArtboard id="browse-mobile-light" label="mobile · light" width={390} height={844}>
            <Board theme={resolveTheme("light")}><BrowseMobile /></Board>
          </DCArtboard>
          <DCArtboard id="browse-mobile-dark" label="mobile · dark" width={390} height={844}>
            <Board theme={resolveTheme("dark")}><BrowseMobile /></Board>
          </DCArtboard>
        </DCSection>

        <DCSection id="notes" title="05 — Notes / new" subtitle="add a note · live preview · deck + tags">
          <DCArtboard id="notes-light" label="form + preview · light" width={1280} height={880}>
            <Board theme={resolveTheme("light")}><NotesV1 /></Board>
          </DCArtboard>
          <DCArtboard id="notes-dark" label="form + preview · dark" width={1280} height={880}>
            <Board theme={resolveTheme("dark")}><NotesV1 /></Board>
          </DCArtboard>
          <DCArtboard id="notes-mobile-light" label="mobile · light" width={390} height={844}>
            <Board theme={resolveTheme("light")}><NotesMobile /></Board>
          </DCArtboard>
          <DCArtboard id="notes-mobile-dark" label="mobile · dark" width={390} height={844}>
            <Board theme={resolveTheme("dark")}><NotesMobile /></Board>
          </DCArtboard>
        </DCSection>

        <DCSection id="stats" title="06 — Stats" subtitle="streak · retention · heatmap · deck breakdown">
          <DCArtboard id="stats-light" label="dashboard · light" width={1280} height={1080}>
            <Board theme={resolveTheme("light")}><StatsV1 height={1080} /></Board>
          </DCArtboard>
          <DCArtboard id="stats-dark" label="dashboard · dark" width={1280} height={1080}>
            <Board theme={resolveTheme("dark")}><StatsV1 height={1080} /></Board>
          </DCArtboard>
          <DCArtboard id="stats-mobile-light" label="mobile · light" width={390} height={844}>
            <Board theme={resolveTheme("light")}><StatsMobile /></Board>
          </DCArtboard>
          <DCArtboard id="stats-mobile-dark" label="mobile · dark" width={390} height={844}>
            <Board theme={resolveTheme("dark")}><StatsMobile /></Board>
          </DCArtboard>
        </DCSection>

        <DCSection id="settings" title="07 — Settings" subtitle="self-hosted sync (M4) · preferences">          <DCArtboard id="settings-light" label="sync tab · light" width={1280} height={880}>
            <Board theme={resolveTheme("light")}><SettingsV1 /></Board>
          </DCArtboard>
          <DCArtboard id="settings-dark" label="sync tab · dark" width={1280} height={880}>
            <Board theme={resolveTheme("dark")}><SettingsV1 /></Board>
          </DCArtboard>
          <DCArtboard id="settings-mobile-light" label="mobile · light" width={390} height={844}>
            <Board theme={resolveTheme("light")}><SettingsMobile /></Board>
          </DCArtboard>
          <DCArtboard id="settings-mobile-dark" label="mobile · dark" width={390} height={844}>
            <Board theme={resolveTheme("dark")}><SettingsMobile /></Board>
          </DCArtboard>
        </DCSection>

        <DCSection id="deck-options" title="08 — Deck options" subtitle="per-deck FSRS · daily limits · learning steps · new deck modal">          <DCArtboard id="deck-opts-light" label="full options · light" width={1280} height={1080}>
            <Board theme={resolveTheme("light")}><DeckOptionsV1 /></Board>
          </DCArtboard>
          <DCArtboard id="deck-opts-dark" label="full options · dark" width={1280} height={1080}>
            <Board theme={resolveTheme("dark")}><DeckOptionsV1 /></Board>
          </DCArtboard>
          <DCArtboard id="deck-new-light" label="new deck modal · light" width={720} height={600}>
            <Board theme={resolveTheme("light")}><NewDeckModal /></Board>
          </DCArtboard>
          <DCArtboard id="deck-new-dark" label="new deck modal · dark" width={720} height={600}>
            <Board theme={resolveTheme("dark")}><NewDeckModal /></Board>
          </DCArtboard>
          <DCArtboard id="deck-opts-mobile-light" label="mobile · light" width={390} height={1280}>
            <Board theme={resolveTheme("light")}><DeckOptionsMobile /></Board>
          </DCArtboard>
          <DCArtboard id="deck-opts-mobile-dark" label="mobile · dark" width={390} height={1280}>
            <Board theme={resolveTheme("dark")}><DeckOptionsMobile /></Board>
          </DCArtboard>
        </DCSection>

        <DCSection id="session-end" title="09 — Session end" subtitle="queue cleared · streak · learned cards · next due">
          <DCArtboard id="end-v1-light" label="full · light" width={1280} height={880}>
            <Board theme={resolveTheme("light")}><SessionEndV1 /></Board>
          </DCArtboard>
          <DCArtboard id="end-v1-dark" label="full · dark" width={1280} height={880}>
            <Board theme={resolveTheme("dark")}><SessionEndV1 /></Board>
          </DCArtboard>
          <DCArtboard id="end-compact-light" label="compact · light" width={1280} height={880}>
            <Board theme={resolveTheme("light")}><SessionEndCompact /></Board>
          </DCArtboard>
          <DCArtboard id="end-compact-dark" label="compact · dark" width={1280} height={880}>
            <Board theme={resolveTheme("dark")}><SessionEndCompact /></Board>
          </DCArtboard>
          <DCArtboard id="end-mobile-light" label="mobile · light" width={390} height={844}>
            <Board theme={resolveTheme("light")}><SessionEndMobile /></Board>
          </DCArtboard>
          <DCArtboard id="end-mobile-dark" label="mobile · dark" width={390} height={844}>
            <Board theme={resolveTheme("dark")}><SessionEndMobile /></Board>
          </DCArtboard>
        </DCSection>
      </DesignCanvas>

      {showTweaks && (
        <TweaksPanel onClose={() => setShowTweaks(false)}>
          <TweakSection title="THEME">
            <TweakRadio
              label="View"
              value={t.themeOverride}
              options={[
                { value: "auto", label: "Both" },
                { value: "light", label: "Light" },
                { value: "dark", label: "Dark" },
              ]}
              onChange={(v) => setTweak("themeOverride", v)}
            />
          </TweakSection>
          <div style={{
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: 10,
            opacity: 0.55,
            marginTop: 14,
            lineHeight: 1.55,
            letterSpacing: "0.05em",
          }}>
            // BOTH = each artboard keeps its own theme (compare side-by-side).<br/>
            // LIGHT/DARK = force every artboard to that theme.
          </div>
        </TweaksPanel>
      )}
    </>
  );
};

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
