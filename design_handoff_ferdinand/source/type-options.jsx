/* CJK type options — same card content in 5 different font families */

const TYPE_OPTIONS = [
  {
    id: "serif",
    family: '"Noto Serif TC", ui-serif, serif',
    name: "Noto Serif TC",
    label: "current",
    note: "標準明體 · classical, encyclopedic",
    vibe: "傳統 · 教科書 · 偏正式",
  },
  {
    id: "wenkai",
    family: '"LXGW WenKai TC", "LXGW WenKai", ui-serif, serif',
    name: "LXGW 霞鶩文楷",
    label: "modern kaisho",
    note: "現代楷體 · 帶手寫感的開源字型",
    vibe: "文具感 · 像鋼筆寫的 · 最時髦",
  },
  {
    id: "klee",
    family: '"Klee One", "Noto Serif TC", serif',
    name: "Klee One",
    label: "textbook hand",
    note: "日本教科書體 · printed pen feel",
    vibe: "學習筆記感 · 跟 kraft 紙搭",
  },
  {
    id: "zenkaku",
    family: '"Zen Kaku Gothic Antique", "Noto Sans TC", sans-serif',
    name: "Zen Kaku Gothic",
    label: "warm geometric",
    note: "幾何無襯線 · 帶古典暗示",
    vibe: "現代簡潔 + 一點手工感",
  },
  {
    id: "sans",
    family: '"Noto Sans TC", ui-sans-serif, system-ui, sans-serif',
    name: "Noto Sans TC",
    label: "neutral sans",
    note: "中性無襯線 · 清晰直接",
    vibe: "最像 app · 最當代",
  },
];

const TypeSpecimen = ({ opt, dark }) => {
  return (
    <div className="theme grain" data-theme={dark ? "dark" : undefined} style={{
      width: 600, padding: "26px 28px",
      background: "var(--paper)",
      border: "1.5px solid var(--ink)",
      borderRadius: 6,
      boxShadow: "3px 3px 0 var(--ink)",
      display: "flex", flexDirection: "column", gap: 16,
    }}>
      {/* header strip */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "flex-end",
        paddingBottom: 12, borderBottom: "1px dashed var(--rule)",
      }}>
        <div>
          <Caption>// {opt.label}</Caption>
          <div style={{
            fontFamily: opt.family,
            fontSize: 22, fontWeight: 600, marginTop: 4, lineHeight: 1.2,
            color: "var(--ink)",
          }}>{opt.name}</div>
        </div>
        <div className="mono" style={{ fontSize: 10, color: "var(--ink-mute)", textAlign: "right", maxWidth: 240 }}>
          {opt.note}
        </div>
      </div>

      {/* big sample — Japanese */}
      <div style={{
        textAlign: "center", padding: "8px 0",
      }}>
        <div style={{
          fontFamily: opt.family,
          fontSize: 56, fontWeight: 500, lineHeight: 1.05, letterSpacing: "0.01em",
        }}>懐かしい</div>
        <div className="mono" style={{ fontSize: 13, color: "var(--accent)", marginTop: 10 }}>
          なつかしい
        </div>
        <div style={{
          fontFamily: opt.family,
          fontSize: 16, marginTop: 6, color: "var(--ink-soft)",
        }}>nostalgic, fondly remembered</div>
      </div>

      {/* example sentence */}
      <div style={{
        fontFamily: opt.family,
        fontSize: 17, lineHeight: 1.7,
        padding: "12px 14px",
        background: "var(--bg-soft)",
        border: "1px solid var(--rule)",
        borderRadius: 4,
      }}>
        昔の写真を見ると懐かしい気持ちになる。<br/>
        老照片總是讓人想起過去的時光。
      </div>

      {/* size scale */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <Caption>// size scale</Caption>
        <div style={{ display: "flex", alignItems: "baseline", gap: 14, fontFamily: opt.family, color: "var(--ink-soft)" }}>
          <span style={{ fontSize: 32, fontWeight: 500 }}>學習</span>
          <span style={{ fontSize: 22 }}>專注力</span>
          <span style={{ fontSize: 16 }}>記憶曲線</span>
          <span style={{ fontSize: 13 }}>間隔重複法</span>
          <span style={{ fontSize: 11, color: "var(--ink-mute)" }}>每日複習</span>
        </div>
      </div>

      {/* mixed CJK + latin */}
      <div style={{
        fontFamily: opt.family,
        fontSize: 14, lineHeight: 1.6,
        color: "var(--ink-soft)",
        paddingTop: 10, borderTop: "1px dashed var(--rule)",
      }}>
        FSRS 演算法 (Free Spaced Repetition Scheduler) 根據 R = retrievability 計算下一次複習時間，
        retention 目標通常設定在 0.90。
      </div>

      {/* vibe */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        paddingTop: 8,
      }}>
        <span className="hand" style={{ color: "var(--accent)", fontSize: 18 }}>{opt.vibe}</span>
        <span className="mono" style={{ fontSize: 9, color: "var(--ink-mute)", letterSpacing: "0.1em", textTransform: "uppercase" }}>
          option · {opt.id}
        </span>
      </div>
    </div>
  );
};

const TypeGrid = ({ dark }) => (
  <div className="theme" data-theme={dark ? "dark" : undefined} style={{
    width: 1280, padding: "32px 40px",
    background: "var(--bg)",
    display: "flex", flexDirection: "column", gap: 24,
  }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
      <div>
        <Caption>// type · cjk options</Caption>
        <div style={{
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: 22, fontWeight: 600, marginTop: 6, letterSpacing: "-0.02em",
        }}>挑一個 CJK 字型
          <span className="hand" style={{ color: "var(--accent)", fontSize: 20, marginLeft: 12 }}>
            same content · 5 fonts
          </span>
        </div>
      </div>
      <div className="mono" style={{ fontSize: 11, color: "var(--ink-mute)", maxWidth: 380, textAlign: "right" }}>
        all available on google fonts · web-safe · weights 400/500/600/700 loaded
      </div>
    </div>

    <div style={{
      display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20,
    }}>
      {TYPE_OPTIONS.map(opt => (
        <TypeSpecimen key={opt.id} opt={opt} dark={dark} />
      ))}
      <div style={{
        padding: "26px 28px",
        background: "var(--bg-soft)",
        border: "1.5px dashed var(--rule)",
        borderRadius: 6,
        display: "flex", flexDirection: "column", gap: 14,
      }}>
        <Caption>// 我的建議</Caption>
        <div className="mono" style={{ fontSize: 13, lineHeight: 1.7, color: "var(--ink-soft)" }}>
          配 kraft 米色底 + Pine Ink，最契合的是<br/>
          <span style={{ color: "var(--accent)", fontWeight: 500 }}>① LXGW 霞鶩文楷</span> — 文具感最強，跟 sketch 線條呼應<br/>
          <span style={{ color: "var(--accent)", fontWeight: 500 }}>② Klee One</span> — 教科書體，最有「學習」感<br/>
          <br/>
          <span style={{ color: "var(--ink-mute)" }}>
            想要 app 感、最現代 → Noto Sans TC<br/>
            想要溫和現代 → Zen Kaku Gothic<br/>
            想要保留正式感 → Noto Serif TC（現在）
          </span>
        </div>
        <div style={{
          marginTop: "auto", paddingTop: 14,
          borderTop: "1px dashed var(--rule)",
        }}>
          <Caption style={{ marginBottom: 6 }}>// 怎麼選</Caption>
          <div style={{ fontSize: 12, color: "var(--ink-mute)", lineHeight: 1.6 }}>
            告訴我「① / ② / ③ / ④ / ⑤」或者「霞鶩 / klee / zenkaku / sans / serif」，
            我直接套到整個 app 上。也可以說「再 X 一點」我來微調。
          </div>
        </div>
      </div>
    </div>
  </div>
);

Object.assign(window, { TypeGrid });
