/* Login screen — Ferdinand
   Variations:
   v1  split layout: sketch panel left, form right
   v2  centered single-column with sketch above form
   Mobile: condensed centered version

   Owl interaction (TunnelBear-inspired):
   - Email input → owl pupils track character count (gaze 0..1 → -1..+1)
   - Password input focus → owl closes eyes
*/

const { useState: _useStateLogin, useRef: _useRefLogin } = React;

/* A "watched" field that reports its value/focus to the owl.
   Identical UX to <Field> but controlled. */
const WatchField = ({ label, hint, leading, placeholder, type = "text", mono = false, optional, value, onChange, onFocus, onBlur }) => (
  <label style={{ display: "block", marginBottom: 18 }}>
    <div style={{
      fontFamily: '"JetBrains Mono", monospace',
      fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase",
      color: "var(--ink-soft)", marginBottom: 8,
      display: "flex", justifyContent: "space-between",
    }}>
      <span>{label}</span>
      {optional && <span style={{ color: "var(--ink-mute)", textTransform: "none", letterSpacing: "0.04em" }}>{optional}</span>}
    </div>
    <div style={{ display: "flex", alignItems: "center", gap: 10, borderBottom: "1.5px solid var(--ink)", paddingBottom: 8 }}>
      {leading && <span style={{ color: "var(--ink-soft)", display: "flex" }}>{leading}</span>}
      <input
        type={type}
        value={value}
        onChange={(e) => onChange && onChange(e.target.value)}
        onFocus={onFocus}
        onBlur={onBlur}
        placeholder={placeholder}
        style={{
          flex: 1, border: "none", outline: "none", background: "transparent",
          color: "var(--ink)",
          fontFamily: mono ? '"JetBrains Mono", monospace' : '"Geist", sans-serif',
          fontSize: 15, padding: "4px 0",
        }}
      />
    </div>
    {hint && <div style={{ fontSize: 12, color: "var(--ink-mute)", marginTop: 6, fontFamily: '"JetBrains Mono", monospace' }}>{hint}</div>}
  </label>
);

/* Compute owl gaze:
   - Idle (email empty, not focused): pupils rest at center (gazeX=0, gazeY=0)
   - Email focused or has text: pupils glance down-left (-5, +2) at the start of typing,
     sweep linearly to (+5, +2) as the field fills toward MAX chars.
   - Password focused: eyes close (no sockets, just lids).
*/
const useOwl = () => {
  const [email, setEmail] = _useStateLogin("");
  const [password, setPassword] = _useStateLogin("");
  const [emailFocus, setEmailFocus] = _useStateLogin(false);
  const [pwFocus, setPwFocus] = _useStateLogin(false);
  const MAX = 24;
  const tracking = emailFocus || email.length > 0;
  const t = Math.min(email.length / MAX, 1);
  const gazeX = tracking ? -5 + t * 9 : 0;
  const gazeY = tracking ? 2 : 0;
  return {
    email, password, pwFocus,
    onEmailChange: setEmail,
    onEmailFocus: () => setEmailFocus(true),
    onEmailBlur: () => setEmailFocus(false),
    onPwChange: setPassword,
    onPwFocus: () => setPwFocus(true),
    onPwBlur: () => setPwFocus(false),
    gazeX, gazeY, closed: pwFocus,
  };
};

const LogoMark = () => (
  <div style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
    <FerdinandMark size={36} />
    <div style={{ display: "flex", flexDirection: "column", lineHeight: 1 }}>
      <div className="mono" style={{ fontSize: 18, fontWeight: 600, letterSpacing: "0.02em" }}>Ferdinand</div>
      <div className="mono" style={{ fontSize: 10, letterSpacing: "0.18em", color: "var(--ink-mute)", marginTop: 4 }}>
        SPACED · REPETITION
      </div>
    </div>
  </div>
);

const FootMeta = () => (
  <div className="mono" style={{
    display: "flex", justifyContent: "space-between",
    fontSize: 10, color: "var(--ink-mute)", letterSpacing: "0.1em",
    paddingTop: 24,
    borderTop: "1px dashed var(--rule)",
    marginTop: 24,
  }}>
    <span>v0.1.0 · selfhost</span>
    <span>NO TELEMETRY</span>
  </div>
);

/* — VARIATION 1 ——————————————————————————————————— */
const LoginV1 = ({ width = 1280, height = 880 }) => {
  const o = useOwl();
  return (
  <div className="theme grain" style={{ width, height, display: "flex", overflow: "hidden", position: "relative" }}>
    {/* LEFT — illustration panel */}
    <div style={{
      flex: "0 0 46%",
      background: "var(--bg-soft)",
      borderRight: "1.5px solid var(--ink)",
      padding: "56px 64px",
      display: "flex",
      flexDirection: "column",
      justifyContent: "space-between",
      position: "relative",
    }}>
      <LogoMark />

      <div style={{ position: "relative" }}>
        <div style={{ position: "absolute", top: -28, left: -8, color: "var(--accent)" }}>
          <SketchSparkles />
        </div>
        {/* Desktop: pupils stay still — owl is on the side, not above the form,
            so directional tracking doesn't read naturally. Mobile keeps tracking. */}
        <SketchOwl size={220} closed={o.closed} />
        <div style={{ position: "absolute", right: 40, top: 30 }}>
          <SketchPlant size={120} />
        </div>
        <div style={{ marginTop: 28, maxWidth: 460 }}>
          <h1 style={{
            fontFamily: '"JetBrains Mono", monospace',
            fontWeight: 500,
            fontSize: 34,
            lineHeight: 1.2,
            letterSpacing: "-0.01em",
            margin: 0,
          }}>
            Quiet pages,<br />
            <span style={{ position: "relative" }}>
              long memory.
              <span style={{ position: "absolute", left: 0, bottom: -10 }}>
                <SketchUnderline width={210} />
              </span>
            </span>
          </h1>
          <p style={{
            marginTop: 28,
            fontSize: 15,
            color: "var(--ink-soft)",
            lineHeight: 1.6,
            maxWidth: 420,
          }}>
            A single-user Anki rebuild. Local first, sync optional, no add-ons,
            no AnkiWeb. Your collection lives on your own server.
          </p>
        </div>
      </div>

      <div className="mono" style={{ fontSize: 11, color: "var(--ink-mute)", letterSpacing: "0.1em" }}>
        <span style={{ marginRight: 16 }}>→ rust core</span>
        <span style={{ marginRight: 16 }}>→ fsrs scheduler</span>
        <span>→ sveltekit</span>
      </div>
    </div>

    {/* RIGHT — form */}
    <div style={{ flex: 1, padding: "72px 88px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
      <div style={{ maxWidth: 380 }}>
        <Caption>// session 01</Caption>
        <h2 style={{
          fontFamily: '"JetBrains Mono", monospace',
          fontWeight: 600,
          fontSize: 28,
          margin: "12px 0 6px",
        }}>Sign in</h2>
        <p style={{ color: "var(--ink-soft)", fontSize: 14, marginBottom: 36 }}>
          Connect to your Ferdinand sync server.
        </p>

        <Field label="Server" leading={<SketchGlobe />} value="sync.ktwu.dev" mono hint="Where your collection lives." />
        <WatchField label="Email" leading={<SketchMail />} placeholder="you@domain.com" value={o.email} onChange={o.onEmailChange} onFocus={o.onEmailFocus} onBlur={o.onEmailBlur} />
        <WatchField label="Password" leading={<SketchLock />} type="password" placeholder="••••••••••"
          value={o.password} onChange={o.onPwChange} onFocus={o.onPwFocus} onBlur={o.onPwBlur}
          optional={<a href="#" style={{ color: "var(--accent)", textDecoration: "none", fontSize: 11 }}>forgot?</a>} />

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 28, marginTop: 8 }}>
          <SketchCheck size={18} />
          <span className="mono" style={{ fontSize: 12, color: "var(--ink-soft)", letterSpacing: "0.04em" }}>
            keep this device signed in
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <Btn kind="primary" size="lg" trailing={<SketchArrow />}>sign in</Btn>
          <a href="#" className="mono" style={{
            fontSize: 12, color: "var(--ink-soft)", textDecoration: "underline",
            textUnderlineOffset: 4, letterSpacing: "0.04em",
          }}>
            run local-only
          </a>
        </div>

        <FootMeta />
      </div>
    </div>

    {/* corner tag */}
    <div className="mono" style={{
      position: "absolute", top: 18, right: 24, fontSize: 10,
      color: "var(--ink-mute)", letterSpacing: "0.18em",
    }}>
      [ FERDINAND // M4 SYNC ]
    </div>
  </div>
);
};

/* — VARIATION 2 ——————————————————————————————————— */
const LoginV2 = ({ width = 1280, height = 880 }) => (
  <div className="theme grain" style={{
    width, height,
    display: "flex", alignItems: "center", justifyContent: "center",
    position: "relative", overflow: "hidden",
  }}>
    {/* scattered ambient sketches */}
    <div style={{ position: "absolute", top: 80, left: 80, opacity: 0.7 }}>
      <SketchPlant size={120} />
    </div>
    <div style={{ position: "absolute", bottom: 90, left: 140, opacity: 0.55 }}>
      <SketchBook size={140} />
    </div>
    <div style={{ position: "absolute", top: 110, right: 110, opacity: 0.6 }}>
      <SketchCardStack size={170} />
    </div>
    <div style={{ position: "absolute", bottom: 100, right: 90, opacity: 0.55 }}>
      <SketchCalendar size={110} />
    </div>

    <div style={{ position: "absolute", top: 32, left: 0, right: 0, display: "flex", justifyContent: "center" }}>
      <LogoMark />
    </div>

    {/* center card — index-card style */}
    <div style={{ width: 460, position: "relative" }}>
      <Panel offset={8}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
          <div>
            <Caption>{'// 01 — sign in'}</Caption>
            <h2 style={{
              fontFamily: '"JetBrains Mono", monospace',
              fontWeight: 600,
              fontSize: 26,
              margin: "10px 0 4px",
            }}>welcome back.</h2>
            <p className="mono" style={{ color: "var(--ink-soft)", fontSize: 12, letterSpacing: "0.04em", margin: 0 }}>
              {'>'} ready to review {'?'}
            </p>
          </div>
          <SketchLeaf size={40} />
        </div>

        <Field label="Server" leading={<SketchGlobe />} value="sync.ktwu.dev" mono />
        <Field label="Email" leading={<SketchMail />} placeholder="you@domain.com" />
        <Field label="Password" leading={<SketchLock />} type="password" placeholder="••••••••••" />

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <SketchCheck size={16} />
            <span className="mono" style={{ fontSize: 11, color: "var(--ink-soft)" }}>remember me</span>
          </div>
          <a href="#" className="mono" style={{ fontSize: 11, color: "var(--accent)", textDecoration: "none" }}>forgot password</a>
        </div>

        <div style={{ marginTop: 28, display: "flex", flexDirection: "column", gap: 12 }}>
          <Btn kind="primary" size="lg" trailing={<SketchArrow />} style={{ justifyContent: "center", width: "100%" }}>sign in</Btn>
          <Btn kind="outline" size="md" style={{ justifyContent: "center", width: "100%" }}>run local-only</Btn>
        </div>
      </Panel>

      <div className="hand" style={{
        position: "absolute", top: -36, right: -40,
        color: "var(--accent)", fontSize: 22, transform: "rotate(-8deg)",
      }}>
        single user. <br /> single laptop.
        <svg width="60" height="40" viewBox="0 0 60 40" className="sketch" style={{ color: "var(--accent)", marginTop: 4 }}>
          <path d="M50 4 C 30 14, 20 30, 10 36 M14 28 L 10 36 L 18 36" />
        </svg>
      </div>
    </div>

    <div className="mono" style={{
      position: "absolute", bottom: 28, left: 0, right: 0,
      display: "flex", justifyContent: "center", gap: 24,
      fontSize: 10, color: "var(--ink-mute)", letterSpacing: "0.18em",
    }}>
      <span>v0.1.0</span><span>·</span><span>SELFHOSTED</span><span>·</span><span>NO TELEMETRY</span>
    </div>
  </div>
);

/* — Mobile —————————————————————————————————————— */
const LoginMobile = ({ width = 390, height = 844 }) => {
  const o = useOwl();
  return (
  <div className="theme grain" style={{
    width, height, position: "relative", overflow: "hidden",
    padding: "56px 28px 32px",
    display: "flex", flexDirection: "column",
  }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <LogoMark />
      <SketchLeaf size={28} />
    </div>

    <div style={{ marginTop: 32, position: "relative", display: "flex", justifyContent: "center" }}>
      <SketchOwl size={160} gazeX={o.gazeX} gazeY={o.gazeY} closed={o.closed} />
      <div style={{ position: "absolute", top: 0, right: 24, color: "var(--accent)" }}>
        <SketchSparkles />
      </div>
    </div>

    <div style={{ marginTop: 16 }}>
      <Caption>{'// session 01'}</Caption>
      <h2 style={{
        fontFamily: '"JetBrains Mono", monospace',
        fontWeight: 600, fontSize: 22, margin: "6px 0 4px",
      }}>sign in</h2>
      <p style={{ fontSize: 13, color: "var(--ink-soft)", margin: "0 0 20px" }}>
        connect to your sync server.
      </p>

      <Field label="Server" leading={<SketchGlobe />} value="sync.ktwu.dev" mono />
      <WatchField label="Email" leading={<SketchMail />} placeholder="you@domain.com" value={o.email} onChange={o.onEmailChange} onFocus={o.onEmailFocus} onBlur={o.onEmailBlur} />
      <WatchField label="Password" leading={<SketchLock />} type="password" placeholder="••••••••••"
        value={o.password} onChange={o.onPwChange} onFocus={o.onPwFocus} onBlur={o.onPwBlur} />

      <Btn kind="primary" size="lg" trailing={<SketchArrow />} style={{ width: "100%", justifyContent: "center", marginTop: 12 }}>
        sign in
      </Btn>
      <Btn kind="ghost" size="md" style={{ width: "100%", justifyContent: "center", marginTop: 8 }}>
        run local-only
      </Btn>
    </div>

    <div className="mono" style={{
      marginTop: "auto", paddingTop: 24,
      display: "flex", justifyContent: "space-between",
      borderTop: "1px dashed var(--rule)",
      fontSize: 10, color: "var(--ink-mute)", letterSpacing: "0.14em",
    }}>
      <span>v0.1.0</span><span>SELFHOSTED · NO TELEMETRY</span>
    </div>
  </div>
);
};

Object.assign(window, { LoginV1, LoginV2, LoginMobile });
