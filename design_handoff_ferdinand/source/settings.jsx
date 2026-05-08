/* Settings — preferences split into sidebar tabs.
   Showing the "sync" tab populated since user mentioned future self-hosted sync.
*/

const SettingsTab = ({ icon, label, on, sub }) => (
  <div style={{
    display: "flex", alignItems: "center", gap: 10,
    padding: "9px 12px", borderRadius: 4,
    background: on ? "var(--paper)" : "transparent",
    border: on ? "1.2px solid var(--ink)" : "1.2px solid transparent",
    boxShadow: on ? "2px 2px 0 var(--ink)" : "none",
    color: on ? "var(--ink)" : "var(--ink-soft)",
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: 13, marginBottom: 4,
    cursor: "pointer",
  }}>
    {icon}
    <div style={{ flex: 1 }}>
      <div style={{ fontWeight: 500 }}>{label}</div>
      {sub && <div style={{ fontSize: 10, color: "var(--ink-mute)", marginTop: 1 }}>{sub}</div>}
    </div>
  </div>
);

/* form primitives */
const Field = ({ k, hint, children }) => (
  <div style={{
    display: "grid", gridTemplateColumns: "200px 1fr", gap: 24, alignItems: "flex-start",
    padding: "18px 0", borderBottom: "1px dashed var(--rule)",
  }}>
    <div>
      <Caption>// {k}</Caption>
      {hint && <div style={{ fontSize: 11, color: "var(--ink-mute)", marginTop: 4, lineHeight: 1.5 }}>{hint}</div>}
    </div>
    <div>{children}</div>
  </div>
);

const TextInput = ({ value, mono = true, prefix, suffix }) => (
  <div style={{
    display: "flex", alignItems: "center", gap: 8,
    padding: "8px 12px",
    border: "1.4px solid var(--ink)", borderRadius: 4,
    background: "var(--paper)", boxShadow: "2px 2px 0 var(--ink)",
    fontFamily: mono ? '"JetBrains Mono", monospace' : '"Geist", sans-serif',
    fontSize: 13,
  }}>
    {prefix && <span style={{ color: "var(--ink-mute)" }}>{prefix}</span>}
    <span style={{ flex: 1 }}>{value}</span>
    {suffix && <span style={{ color: "var(--ink-mute)", fontSize: 11 }}>{suffix}</span>}
  </div>
);

const Toggle = ({ on, label, desc }) => (
  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 18 }}>
    <div>
      <div className="mono" style={{ fontSize: 13, fontWeight: 500 }}>{label}</div>
      {desc && <div style={{ fontSize: 11, color: "var(--ink-mute)", marginTop: 2, lineHeight: 1.5 }}>{desc}</div>}
    </div>
    <div style={{
      width: 42, height: 22,
      border: "1.4px solid var(--ink)", borderRadius: 999,
      background: on ? "var(--accent)" : "var(--paper)",
      position: "relative", flexShrink: 0,
      boxShadow: "2px 2px 0 var(--ink)",
    }}>
      <div style={{
        position: "absolute", top: 1, left: on ? 21 : 1, width: 18, height: 18,
        borderRadius: 999, background: on ? "var(--bg)" : "var(--ink)",
        transition: "left 200ms ease",
      }} />
    </div>
  </div>
);

const RadioRow = ({ options, selected }) => (
  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
    {options.map((o) => (
      <span key={o} className="mono" style={{
        padding: "7px 14px",
        border: "1.2px solid var(--ink)", borderRadius: 4,
        background: o === selected ? "var(--ink)" : "var(--paper)",
        color: o === selected ? "var(--bg)" : "var(--ink-soft)",
        fontSize: 12, letterSpacing: "0.04em",
        cursor: "pointer",
      }}>{o}</span>
    ))}
  </div>
);

const SettingsV1 = ({ width = 1280, height = 880 }) => (
  <div className="theme grain" style={{ width, height, display: "flex", overflow: "hidden" }}>
    <NavRail />
    <main style={{ flex: 1, display: "flex", overflow: "hidden" }}>
      {/* settings sub-sidebar */}
      <aside style={{
        width: 260, padding: "32px 22px 24px",
        borderRight: "1.5px solid var(--ink)",
        background: "var(--bg-soft)",
        display: "flex", flexDirection: "column", gap: 22, flexShrink: 0,
      }}>
        <div>
          <Caption>// settings</Caption>
          <h1 style={{
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: 22, fontWeight: 600, margin: "6px 0 0", letterSpacing: "-0.02em",
          }}>preferences</h1>
        </div>

        <div>
          <Caption style={{ marginBottom: 10 }}>// sections</Caption>
          <SettingsTab icon={<SketchUser size={14} />} label="general" sub="profile, language" />
          <SettingsTab icon={<SketchClock size={14} />} label="scheduling" sub="FSRS, learning steps" />
          <SettingsTab icon={<SketchGlobe size={14} />} label="sync" sub="self-hosted server" on />
          <SettingsTab icon={<SketchBook size={14} />} label="appearance" sub="theme, fonts" />
          <SettingsTab icon={<SketchLock size={14} />} label="security" sub="passcode lock" />
          <SettingsTab icon={<SketchCardStack size={14} />} label="data" sub="import, export, reset" />
          <SettingsTab icon={<SketchSpark size={14} />} label="experimental" sub="beta features" />
        </div>

        <div style={{ marginTop: "auto", borderTop: "1px dashed var(--rule)", paddingTop: 14 }}>
          <Caption style={{ marginBottom: 6 }}>// build</Caption>
          <div className="mono" style={{ fontSize: 11, color: "var(--ink-soft)", lineHeight: 1.6 }}>
            <div>ferdinand v0.4.2</div>
            <div style={{ color: "var(--ink-mute)" }}>m1 · 2026-04-28</div>
            <div style={{ color: "var(--accent)", marginTop: 4 }}>up to date ✓</div>
          </div>
        </div>
      </aside>

      {/* main pane */}
      <div style={{ flex: 1, padding: "32px 48px", overflow: "auto" }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 24 }}>
          <div>
            <Caption>// sync.config</Caption>
            <h2 style={{
              fontFamily: '"JetBrains Mono", monospace',
              fontSize: 26, fontWeight: 600, margin: "6px 0 4px", letterSpacing: "-0.02em",
            }}>self-hosted sync
              <span className="hand" style={{ color: "var(--accent)", fontSize: 22, marginLeft: 12 }}>your collection, your server</span>
            </h2>
            <div style={{ fontSize: 13, color: "var(--ink-soft)", maxWidth: 540 }}>
              Ferdinand drops AnkiWeb sync. Point it at your own server (M4) and your collection round-trips between desktop and iOS without a third party.
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Btn kind="ghost" size="sm">discard</Btn>
            <Btn kind="primary" size="sm">save changes</Btn>
          </div>
        </header>

        <Field k="status" hint="Last sync 2 hours ago. Next auto-sync in ~58m.">
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{
              width: 10, height: 10, borderRadius: 999,
              background: "var(--accent)", border: "1.4px solid var(--ink)",
              boxShadow: "0 0 0 4px color-mix(in oklch, var(--accent) 22%, transparent)",
            }} />
            <span className="mono" style={{ fontSize: 13, color: "var(--accent)", fontWeight: 500 }}>connected</span>
            <span className="mono" style={{ fontSize: 11, color: "var(--ink-mute)" }}>· 5,412 cards · 142 MB</span>
            <Btn kind="paper" size="sm" style={{ marginLeft: "auto" }}>sync now</Btn>
          </div>
        </Field>

        <Field k="server endpoint" hint="HTTPS endpoint of your Ferdinand sync server. Paths /sync/v1/* are the contract.">
          <TextInput value="sync.ferdinand.local" prefix="https://" suffix=":8443" />
        </Field>

        <Field k="account" hint="A passphrase derives the key that encrypts your collection client-side before upload.">
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <TextInput value="kt@ferdinand.local" mono={false} prefix={<SketchMail size={14} />} />
            <TextInput value="••••••••••••" prefix={<SketchLock size={14} />} suffix="rotated 14d ago" />
          </div>
        </Field>

        <Field k="schedule" hint="Background sync interval when the app is open.">
          <RadioRow options={["off", "5 min", "15 min", "1 hour", "manual only"]} selected="1 hour" />
        </Field>

        <Field k="conflict policy" hint="When the same card is edited on two devices.">
          <RadioRow options={["latest wins", "ask me", "merge fields"]} selected="ask me" />
        </Field>

        <Field k="encryption" hint="Collection is e2e encrypted; the server never sees plaintext.">
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <Toggle on label="end-to-end encryption" desc="Required for any sync operation. Cannot be disabled in M4." />
            <Toggle on label="encrypt media (images, audio)" desc="Slower upload but full attachment privacy." />
            <Toggle label="anonymous telemetry" desc="Help diagnose sync errors. Off by default." />
          </div>
        </Field>

        <Field k="connected devices" hint="Devices currently registered to this account.">
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {[
              { n: "MacBook Air · M3", id: "this device", last: "now", on: true },
              { n: "iPhone 15 Pro", id: "ios · v0.4.0", last: "2h ago" },
              { n: "Studio Mac · ferdinand-cli", id: "headless", last: "3d ago" },
            ].map(d => (
              <div key={d.n} style={{
                display: "grid", gridTemplateColumns: "20px 1fr auto auto",
                gap: 12, alignItems: "center",
                padding: "10px 14px",
                border: "1.2px solid var(--ink)", borderRadius: 4,
                background: "var(--paper)",
              }}>
                <SketchGlobe size={14} />
                <div>
                  <div className="mono" style={{ fontSize: 12, fontWeight: 500 }}>{d.n} {d.on && <span style={{ color: "var(--accent)" }}>·</span>}</div>
                  <div className="mono" style={{ fontSize: 10, color: "var(--ink-mute)" }}>{d.id}</div>
                </div>
                <span className="mono" style={{ fontSize: 10, color: "var(--ink-mute)" }}>last {d.last}</span>
                <Btn kind="ghost" size="sm" style={{ color: d.on ? "var(--ink-mute)" : "var(--due)" }}>
                  {d.on ? "this device" : "revoke"}
                </Btn>
              </div>
            ))}
          </div>
        </Field>

        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          marginTop: 28, padding: "16px 18px",
          background: "var(--bg-soft)",
          border: "1px dashed var(--due)", borderRadius: 4,
        }}>
          <div>
            <Caption style={{ color: "var(--due)" }}>// danger zone</Caption>
            <div className="mono" style={{ fontSize: 13, fontWeight: 500, marginTop: 4 }}>disconnect from server</div>
            <div style={{ fontSize: 11, color: "var(--ink-mute)", marginTop: 2 }}>Local copy is kept. Re-pairing requires the passphrase.</div>
          </div>
          <Btn kind="outline" size="sm" style={{ borderColor: "var(--due)", color: "var(--due)" }}>disconnect</Btn>
        </div>
      </div>
    </main>
  </div>
);

const SettingsMobile = ({ width = 390, height = 844 }) => (
  <div className="theme grain" style={{ width, height, position: "relative", overflow: "hidden", display: "flex", flexDirection: "column" }}>
    <header style={{
      padding: "48px 22px 14px",
      borderBottom: "1.5px solid var(--ink)",
      display: "flex", justifyContent: "space-between", alignItems: "center",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Btn kind="ghost" size="sm" style={{ padding: "4px 4px" }}>←</Btn>
        <div>
          <Caption>// settings</Caption>
          <div className="mono" style={{ fontSize: 14, fontWeight: 600, marginTop: 1 }}>sync</div>
        </div>
      </div>
      <Btn kind="primary" size="sm">save</Btn>
    </header>

    <main style={{ flex: 1, overflow: "auto", padding: "16px 22px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "12px 14px",
        background: "var(--paper)", border: "1.4px solid var(--ink)", borderRadius: 4,
        boxShadow: "2px 2px 0 var(--ink)",
      }}>
        <span style={{
          width: 10, height: 10, borderRadius: 999,
          background: "var(--accent)", border: "1.4px solid var(--ink)",
        }} />
        <div style={{ flex: 1 }}>
          <div className="mono" style={{ fontSize: 12, fontWeight: 500, color: "var(--accent)" }}>connected</div>
          <div className="mono" style={{ fontSize: 10, color: "var(--ink-mute)" }}>last sync · 2h ago</div>
        </div>
        <Btn kind="paper" size="sm">sync</Btn>
      </div>

      <div>
        <Caption style={{ marginBottom: 8 }}>// server</Caption>
        <TextInput value="sync.ferdinand.local" prefix="https://" suffix=":8443" />
      </div>

      <div>
        <Caption style={{ marginBottom: 8 }}>// account</Caption>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <TextInput value="kt@ferdinand.local" mono={false} prefix={<SketchMail size={14} />} />
          <TextInput value="••••••••••••" prefix={<SketchLock size={14} />} />
        </div>
      </div>

      <div>
        <Caption style={{ marginBottom: 8 }}>// schedule</Caption>
        <RadioRow options={["off", "15m", "1h", "manual"]} selected="1h" />
      </div>

      <div style={{
        background: "var(--paper)", border: "1.4px solid var(--ink)",
        borderRadius: 4, padding: "14px 16px", boxShadow: "2px 2px 0 var(--ink)",
        display: "flex", flexDirection: "column", gap: 14,
      }}>
        <Toggle on label="end-to-end encryption" desc="Always on in M4." />
        <Toggle on label="encrypt media" desc="Images, audio attachments." />
        <Toggle label="background sync (cellular)" />
      </div>

      <div>
        <Caption style={{ marginBottom: 8 }}>// devices · 3</Caption>
        {[
          { n: "MacBook Air", id: "this device", on: true },
          { n: "iPhone 15 Pro", id: "ios · 2h ago" },
          { n: "Studio Mac", id: "headless · 3d ago" },
        ].map(d => (
          <div key={d.n} style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "10px 12px", marginBottom: 6,
            border: "1.2px solid var(--ink)", borderRadius: 4,
            background: "var(--paper)",
          }}>
            <SketchGlobe size={14} />
            <div style={{ flex: 1 }}>
              <div className="mono" style={{ fontSize: 12, fontWeight: 500 }}>{d.n}</div>
              <div className="mono" style={{ fontSize: 10, color: "var(--ink-mute)" }}>{d.id}</div>
            </div>
            <span className="mono" style={{ fontSize: 10, color: d.on ? "var(--accent)" : "var(--ink-mute)" }}>
              {d.on ? "active" : "→"}
            </span>
          </div>
        ))}
      </div>

      <div style={{
        padding: "12px 14px",
        border: "1px dashed var(--due)", borderRadius: 4,
        background: "var(--bg-soft)",
        display: "flex", justifyContent: "space-between", alignItems: "center",
      }}>
        <div>
          <div className="mono" style={{ fontSize: 12, fontWeight: 500 }}>disconnect</div>
          <div style={{ fontSize: 10, color: "var(--ink-mute)" }}>local data kept</div>
        </div>
        <Btn kind="outline" size="sm" style={{ borderColor: "var(--due)", color: "var(--due)" }}>disconnect</Btn>
      </div>
    </main>
  </div>
);

Object.assign(window, { SettingsV1, SettingsMobile });
