/* Shared primitives — buttons, inputs, panels — sketch-aesthetic. */

const Btn = ({ kind = "primary", size = "md", children, leading, trailing, style, ...rest }) => {
  const base = {
    fontFamily: '"JetBrains Mono", ui-monospace, monospace',
    fontWeight: 500,
    fontSize: size === "lg" ? 14 : size === "sm" ? 12 : 13,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    border: "1.5px solid var(--ink)",
    borderRadius: 4,
    padding: size === "lg" ? "12px 22px" : size === "sm" ? "6px 12px" : "9px 16px",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    transition: "transform 100ms ease, box-shadow 100ms ease",
    boxShadow: "2px 2px 0 var(--ink)",
    background: "var(--paper)",
    color: "var(--ink)",
  };
  const variants = {
    primary: { background: "var(--accent)", color: "var(--bg)", borderColor: "var(--ink)" },
    ghost:   { background: "transparent", boxShadow: "none", borderColor: "transparent", padding: size === "sm" ? "4px 8px" : "6px 10px" },
    outline: { background: "transparent" },
    paper:   { background: "var(--paper)" },
  };
  return (
    <button {...rest} style={{ ...base, ...variants[kind], ...style }}>
      {leading}{children}{trailing}
    </button>
  );
};

const Field = ({ label, hint, leading, value, placeholder, type = "text", mono = false, optional }) => (
  <label style={{ display: "block", marginBottom: 18 }}>
    <div style={{
      fontFamily: '"JetBrains Mono", monospace',
      fontSize: 11,
      letterSpacing: "0.1em",
      textTransform: "uppercase",
      color: "var(--ink-soft)",
      marginBottom: 8,
      display: "flex",
      justifyContent: "space-between",
    }}>
      <span>{label}</span>
      {optional && <span style={{ color: "var(--ink-mute)", textTransform: "none", letterSpacing: "0.04em" }}>{optional}</span>}
    </div>
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 10,
      borderBottom: "1.5px solid var(--ink)",
      paddingBottom: 8,
    }}>
      {leading && <span style={{ color: "var(--ink-soft)", display: "flex" }}>{leading}</span>}
      <input
        type={type}
        defaultValue={value}
        placeholder={placeholder}
        style={{
          flex: 1,
          border: "none",
          outline: "none",
          background: "transparent",
          color: "var(--ink)",
          fontFamily: mono ? '"JetBrains Mono", monospace' : '"Geist", sans-serif',
          fontSize: 15,
          padding: "4px 0",
        }}
      />
    </div>
    {hint && <div style={{ fontSize: 12, color: "var(--ink-mute)", marginTop: 6, fontFamily: '"JetBrains Mono", monospace' }}>{hint}</div>}
  </label>
);

/* A torn-paper / index-card panel — sketch border with offset */
const Panel = ({ children, style, offset = 6 }) => (
  <div style={{ position: "relative", ...style }}>
    <div style={{
      position: "absolute", inset: 0,
      transform: `translate(${offset}px, ${offset}px)`,
      background: "var(--ink)",
      borderRadius: 6,
      opacity: 0.12,
    }} />
    <div style={{
      position: "relative",
      background: "var(--paper)",
      border: "1.5px solid var(--ink)",
      borderRadius: 6,
      padding: 24,
    }}>{children}</div>
  </div>
);

/* Mono caption with leading slash */
const Caption = ({ children, color = "var(--ink-soft)", style }) => (
  <div className="mono" style={{
    fontSize: 11,
    letterSpacing: "0.14em",
    textTransform: "uppercase",
    color,
    ...style,
  }}>{children}</div>
);

/* Hand-drawn pill chip */
const Chip = ({ children, color, bg }) => (
  <span className="mono" style={{
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    fontSize: 11,
    letterSpacing: "0.06em",
    padding: "3px 10px",
    border: `1.2px solid ${color || "var(--ink)"}`,
    borderRadius: 999,
    color: color || "var(--ink)",
    background: bg || "transparent",
    textTransform: "uppercase",
  }}>{children}</span>
);

/* Hand-drawn progress (3 segments: new / learn / review) */
const QueueBar = ({ n = 0, l = 0, r = 0, total, width = 220 }) => {
  const sum = n + l + r;
  const pct = (v) => sum ? `${(v / sum) * 100}%` : 0;
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 8, width: typeof width === "string" ? width : undefined }}>
      <div style={{
        height: 8,
        width: typeof width === "string" ? "100%" : width,
        flex: typeof width === "string" ? 1 : undefined,
        borderRadius: 4,
        background: "var(--bg-soft)",
        border: "1px solid var(--rule)",
        display: "flex",
        overflow: "hidden",
      }}>
        {n > 0 && <div style={{ width: pct(n), background: "var(--due)" }} />}
        {l > 0 && <div style={{ width: pct(l), background: "var(--warn)" }} />}
        {r > 0 && <div style={{ width: pct(r), background: "var(--accent)" }} />}
      </div>
      {total != null && (
        <span className="mono" style={{ fontSize: 11, color: "var(--ink-mute)" }}>
          {sum}/{total}
        </span>
      )}
    </div>
  );
};

/* Tiny bar chart for activity */
const ActivityBars = ({ data, width = 240, height = 38 }) => {
  const max = Math.max(...data, 1);
  const bw = width / data.length;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} aria-hidden="true">
      {data.map((v, i) => {
        const h = (v / max) * (height - 4);
        return (
          <rect key={i}
            x={i * bw + 1}
            y={height - h - 1}
            width={Math.max(bw - 2, 2)}
            height={h}
            fill={v === 0 ? "var(--rule)" : "var(--accent)"}
            opacity={v === 0 ? 0.4 : 0.8}
          />
        );
      })}
    </svg>
  );
};

/* Hand-drawn dashed divider */
const Divider = ({ style }) => (
  <div style={{
    height: 0,
    borderTop: "1px dashed var(--rule)",
    ...style,
  }} />
);

Object.assign(window, { Btn, Field, Panel, Caption, Chip, QueueBar, ActivityBars, Divider });
