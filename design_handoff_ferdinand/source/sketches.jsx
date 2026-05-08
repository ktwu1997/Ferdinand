/* Hand-drawn line illustrations — the visual foundation of Ferdinand UI.
   All strokes use currentColor so they inherit theme ink color.
   Slight irregularities baked into bezier paths for a sketched feel. */

const Mark = ({ children, w = 24, h = 24, vb = "0 0 24 24", className = "", style }) => (
  <svg viewBox={vb} width={w} height={h} className={"sketch " + className} style={style} aria-hidden="true">{children}</svg>
);

/* — Brand mark: F with a leaf —————————————————————————————— */
const FerdinandMark = ({ size = 36 }) => (
  <Mark w={size} h={size} vb="0 0 40 40" className="thick">
    {/* F shape, slightly wobbly */}
    <path d="M10.5 5.4 C 10.2 14, 10.4 24, 10.7 33.6" />
    <path d="M10.7 5.6 C 17, 5.2, 23.5, 5.1, 28.6 5.5" />
    <path d="M10.7 19.2 C 15.4, 18.9, 19.6, 18.8, 23.2 19.1" />
    {/* A small leaf accent on the top bar */}
    <path d="M28.8 5.5 C 32.5, 4, 34.6, 6.4, 33.4 9.8 C 32.2, 13, 28.6, 12.5, 27.4 9.2 Z" className="fill-accent-soft" style={{ stroke: "var(--accent)" }} />
    <path d="M30 8.4 L 32 6.8" style={{ stroke: "var(--accent)" }} />
  </Mark>
);

/* — Stack of cards (study, deck) ————————————————————————— */
const SketchCardStack = ({ size = 160 }) => (
  <Mark w={size} h={size} vb="0 0 160 160">
    {/* Back card */}
    <path d="M28 38 C 27.6 36, 28.8 34.4, 30.6 34.2 L 116 30.4 C 118 30.2, 119.4 31.6, 119.6 33.4 L 124.4 100 C 124.6 101.8, 123.2 103.2, 121.4 103.4 L 36 107.2 C 34.2 107.4, 32.6 106, 32.4 104 Z" className="fill-paper" />
    {/* Middle card */}
    <path d="M22 56 C 21.6 54, 22.8 52.4, 24.6 52.2 L 110 48.4 C 112 48.2, 113.4 49.6, 113.6 51.4 L 118.4 118 C 118.6 119.8, 117.2 121.2, 115.4 121.4 L 30 125.2 C 28.2 125.4, 26.6 124, 26.4 122 Z" className="fill-paper" />
    {/* Front card */}
    <path d="M16 76 C 15.6 74, 16.8 72.4, 18.6 72.2 L 104 68.4 C 106 68.2, 107.4 69.6, 107.6 71.4 L 112.4 138 C 112.6 139.8, 111.2 141.2, 109.4 141.4 L 24 145.2 C 22.2 145.4, 20.6 144, 20.4 142 Z" className="fill-paper" />
    {/* lines on the front card */}
    <path d="M30 92 L 92 89.5" className="thin" />
    <path d="M30 102 L 80 100" className="thin" />
    <path d="M30 112 L 86 110" className="thin" />
    <path d="M30 122 L 70 120.5" className="thin" />
    {/* a small star/spark above */}
    <path d="M132 28 L 132 38 M127 33 L 137 33" style={{ stroke: "var(--accent)" }} />
  </Mark>
);

/* — Plant in pot (growth, study habit) —————————————————— */
const SketchPlant = ({ size = 140 }) => (
  <Mark w={size} h={size} vb="0 0 140 140">
    {/* pot */}
    <path d="M44 96 L 52 130 C 52.4 132, 54 133.2, 56 133.2 L 84 133 C 86 133, 87.6 131.8, 88 130 L 96 96 Z" className="fill-paper" />
    <path d="M40 96 L 100 96" className="thick" />
    {/* stem */}
    <path d="M70 96 C 70 80, 70 60, 70 38" />
    {/* leaves */}
    <path d="M70 80 C 60 76, 48 70, 40 60 C 50 56, 64 64, 70 76" className="fill-accent-soft" style={{ stroke: "var(--accent)" }} />
    <path d="M70 64 C 80 60, 92 54, 100 44 C 96 56, 84 66, 72 70" className="fill-accent-soft" style={{ stroke: "var(--accent)" }} />
    <path d="M70 50 C 64 42, 60 32, 62 22 C 70 26, 74 38, 72 48" className="fill-accent-soft" style={{ stroke: "var(--accent)" }} />
    {/* little root marks below */}
    <path d="M48 110 L 50 113 M60 110 L 60 114 M80 110 L 80 113 M92 110 L 90 113" className="thin" />
  </Mark>
);

/* — Open book ——————————————————————————————————————— */
const SketchBook = ({ size = 140 }) => (
  <Mark w={size} h={size} vb="0 0 140 140">
    <path d="M14 40 C 30 36, 50 36, 70 44 C 90 36, 110 36, 126 40 L 126 110 C 110 106, 90 106, 70 114 C 50 106, 30 106, 14 110 Z" className="fill-paper" />
    <path d="M70 44 L 70 114" />
    <path d="M22 50 C 36 48, 50 48, 64 54" className="thin" />
    <path d="M22 60 C 36 58, 50 58, 64 64" className="thin" />
    <path d="M22 70 C 36 68, 50 68, 64 74" className="thin" />
    <path d="M76 54 C 90 48, 104 48, 118 50" className="thin" />
    <path d="M76 64 C 90 58, 104 58, 118 60" className="thin" />
    <path d="M76 74 C 90 68, 104 68, 118 70" className="thin" />
    <path d="M76 84 C 90 78, 104 78, 118 80" className="thin" />
  </Mark>
);

/* — Sapling/leaf solo (small accent) ————————————————— */
const SketchLeaf = ({ size = 36 }) => (
  <Mark w={size} h={size} vb="0 0 36 36">
    <path d="M6 30 C 6 18, 14 8, 30 6 C 28 22, 18 30, 6 30 Z" className="fill-accent-soft" style={{ stroke: "var(--accent)" }} />
    <path d="M6 30 C 14 22, 22 14, 30 6" style={{ stroke: "var(--accent)" }} />
  </Mark>
);

/* — Owl (study companion, brand vibe) ——————————————— */
const SketchOwl = ({ size = 160, gazeX = 0, gazeY = 0, closed = false }) => (
  <Mark w={size} h={size} vb="0 0 160 160">
    {/* body */}
    <path d="M48 60 C 44 86, 52 124, 80 130 C 108 124, 116 86, 112 60 C 110 38, 96 24, 80 24 C 64 24, 50 38, 48 60 Z" className="fill-paper" />
    {closed ? (
      <g style={{ transition: "opacity 200ms ease" }}>
        {/* closed eye lids — downward curves (sleeping/satisfied shape) */}
        <path d="M65 58 C 69 64, 75 64, 79 58" className="thick" />
        <path d="M87 58 C 91 64, 97 64, 101 58" className="thick" />
        {/* sleepy eyelashes — drooping downward */}
        <path d="M67 62 L 66 65 M72 64 L 72 67 M93 64 L 93 67 M99 62 L 100 65" className="thin" />
      </g>
    ) : (
      <g>
        {/* eye sockets */}
        <path d="M62 60 C 62 50, 70 46, 76 50 C 80 54, 80 64, 74 68 C 66 70, 60 66, 62 60 Z" />
        <path d="M84 60 C 84 50, 92 46, 98 50 C 102 54, 102 64, 96 68 C 88 70, 82 66, 84 60 Z" />
        {/* pupils — track gaze */}
        <g style={{ transition: "transform 220ms cubic-bezier(0.16,1,0.3,1)", transform: `translate(${gazeX}px, ${gazeY}px)` }}>
          <circle cx="72" cy="58" r="2.5" fill="currentColor" />
          <circle cx="94" cy="58" r="2.5" fill="currentColor" />
        </g>
      </g>
    )}
    {/* beak */}
    <path d="M78 68 L 80 76 L 82 68" />
    {/* belly tufts */}
    <path d="M64 88 C 70 92, 76 92, 80 88" className="thin" />
    <path d="M80 88 C 84 92, 90 92, 96 88" className="thin" />
    <path d="M60 102 C 68 106, 74 106, 80 102" className="thin" />
    <path d="M80 102 C 86 106, 92 106, 100 102" className="thin" />
    {/* feet */}
    <path d="M68 130 L 68 138 M64 138 L 72 138" className="thin" />
    <path d="M92 130 L 92 138 M88 138 L 96 138" className="thin" />
    {/* tiny floating leaf */}
    <path d="M126 36 C 130 30, 138 30, 140 38 C 134 42, 128 40, 126 36 Z" style={{ stroke: "var(--accent)" }} className="fill-accent-soft" />
  </Mark>
);

/* — Calendar grid ——————————————————————————— */
const SketchCalendar = ({ size = 100 }) => (
  <Mark w={size} h={size} vb="0 0 100 100">
    <path d="M10 22 C 10 19, 12 17, 15 17 L 85 17 C 88 17, 90 19, 90 22 L 90 86 C 90 89, 88 91, 85 91 L 15 91 C 12 91, 10 89, 10 86 Z" className="fill-paper" />
    <path d="M10 32 L 90 32" />
    <path d="M22 12 L 22 22 M40 12 L 40 22 M58 12 L 58 22 M76 12 L 76 22" />
    {/* dots for filled days */}
    <circle cx="22" cy="44" r="2.4" fill="currentColor" />
    <circle cx="34" cy="44" r="2.4" fill="currentColor" />
    <circle cx="46" cy="44" r="2.4" fill="currentColor" />
    <circle cx="58" cy="44" r="2.4" fill="currentColor" />
    <circle cx="22" cy="56" r="2.4" fill="currentColor" />
    <circle cx="34" cy="56" r="2.4" fill="currentColor" />
    <circle cx="46" cy="56" r="2.4" fill="currentColor" />
    {/* missed day */}
    <path d="M58 53 L 58 59 M55 56 L 61 56" className="thin" style={{ stroke: "var(--ink-mute)" }} />
    <circle cx="22" cy="68" r="2.4" fill="var(--accent)" />
    <circle cx="34" cy="68" r="2.4" fill="var(--accent)" />
  </Mark>
);

/* — Spark / star ——————————————————————————— */
const SketchSpark = ({ size = 24, color = "var(--accent)" }) => (
  <Mark w={size} h={size} vb="0 0 24 24" style={{ color }}>
    <path d="M12 2 L 12 22 M2 12 L 22 12" />
    <path d="M5 5 L 19 19 M19 5 L 5 19" className="thin" />
  </Mark>
);

/* — Wavy underline accent ————————————————————— */
const SketchUnderline = ({ width = 120, color = "var(--accent)" }) => (
  <svg viewBox={`0 0 ${width} 10`} width={width} height={10} className="sketch" style={{ color, display: "block" }} aria-hidden="true">
    <path d={`M2 6 C ${width*0.2} 1, ${width*0.4} 9, ${width*0.5} 5 S ${width*0.8} 1, ${width-2} 6`} />
  </svg>
);

/* — Squiggle/scribble divider ——————————————————— */
const SketchScribble = ({ width = 60, color = "currentColor" }) => (
  <svg viewBox={`0 0 ${width} 12`} width={width} height={12} className="sketch" style={{ color, display: "block" }} aria-hidden="true">
    <path d={`M2 6 C 8 1, 14 11, 20 6 S 32 1, 38 6 S 50 11, ${width-2} 6`} className="thin" />
  </svg>
);

/* — Hand-drawn checkbox (checked) ————————————— */
const SketchCheck = ({ size = 18 }) => (
  <Mark w={size} h={size} vb="0 0 18 18">
    <path d="M2.5 4 C 2.4 3, 3 2.4, 4 2.5 L 14 2.5 C 15 2.5, 15.6 3.1, 15.5 4 L 15.5 14 C 15.5 15, 15 15.6, 14 15.5 L 4 15.5 C 3 15.5, 2.4 15, 2.5 14 Z" />
    <path d="M5 9 L 8 12 L 14 5" style={{ stroke: "var(--accent)" }} className="thick" />
  </Mark>
);

/* — Arrow (right) ——————————————————————————— */
const SketchArrow = ({ size = 22 }) => (
  <Mark w={size} h={size} vb="0 0 22 14">
    <path d="M2 7 L 19 7 M14 2 L 19 7 L 14 12" />
  </Mark>
);

/* — Clock —————————————————————————————————— */
const SketchClock = ({ size = 18 }) => (
  <Mark w={size} h={size} vb="0 0 18 18">
    <circle cx="9" cy="9" r="7" />
    <path d="M9 4.5 L 9 9 L 12.5 11" />
  </Mark>
);

/* — Globe (sync server) ——————————————————— */
const SketchGlobe = ({ size = 18 }) => (
  <Mark w={size} h={size} vb="0 0 18 18">
    <circle cx="9" cy="9" r="7" />
    <path d="M2 9 L 16 9" />
    <path d="M9 2 C 5 6, 5 12, 9 16" />
    <path d="M9 2 C 13 6, 13 12, 9 16" />
  </Mark>
);

/* — Lock —————————————————————————————————— */
const SketchLock = ({ size = 18 }) => (
  <Mark w={size} h={size} vb="0 0 18 18">
    <path d="M3.5 8 L 14.5 8 C 15.2 8, 15.5 8.4, 15.5 9 L 15.5 15 C 15.5 15.6, 15.2 16, 14.5 16 L 3.5 16 C 2.8 16, 2.5 15.6, 2.5 15 L 2.5 9 C 2.5 8.4, 2.8 8, 3.5 8 Z" />
    <path d="M5.5 8 L 5.5 5.5 C 5.5 3, 7 2, 9 2 C 11 2, 12.5 3, 12.5 5.5 L 12.5 8" />
  </Mark>
);

/* — Mail —————————————————————————————————— */
const SketchMail = ({ size = 18 }) => (
  <Mark w={size} h={size} vb="0 0 18 18">
    <path d="M2.5 5 L 15.5 5 C 16 5, 16.2 5.3, 16.2 5.7 L 16.2 13 C 16.2 13.5, 15.8 13.7, 15.5 13.7 L 2.5 13.7 C 2.1 13.7, 1.8 13.4, 1.8 13 L 1.8 5.7 C 1.8 5.3, 2 5, 2.5 5 Z" />
    <path d="M2 5.5 L 9 10 L 16 5.5" />
  </Mark>
);

/* — Plus icon ——————————————————————————— */
const SketchPlus = ({ size = 18 }) => (
  <Mark w={size} h={size} vb="0 0 18 18">
    <path d="M9 3 L 9 15 M3 9 L 15 9" />
  </Mark>
);

/* — Search ——————————————————————————————— */
const SketchSearch = ({ size = 18 }) => (
  <Mark w={size} h={size} vb="0 0 18 18">
    <circle cx="8" cy="8" r="5" />
    <path d="M11.5 11.5 L 16 16" />
  </Mark>
);

/* — Settings/gear (simplified) ————————— */
const SketchGear = ({ size = 18 }) => (
  <Mark w={size} h={size} vb="0 0 18 18">
    <circle cx="9" cy="9" r="3" />
    <path d="M9 1.5 L 9 4 M9 14 L 9 16.5 M1.5 9 L 4 9 M14 9 L 16.5 9 M3.5 3.5 L 5 5 M13 13 L 14.5 14.5 M3.5 14.5 L 5 13 M13 5 L 14.5 3.5" className="thin" />
  </Mark>
);

/* — User —————————————————————————————————— */
const SketchUser = ({ size = 18 }) => (
  <Mark w={size} h={size} vb="0 0 18 18">
    <circle cx="9" cy="6.5" r="3" />
    <path d="M2.5 16 C 3 12, 5.5 10, 9 10 C 12.5 10, 15 12, 15.5 16" />
  </Mark>
);

/* — Flame (streak) —————————————————————— */
const SketchFlame = ({ size = 18 }) => (
  <Mark w={size} h={size} vb="0 0 18 18">
    <path d="M9 1.5 C 7 5, 4 6.5, 4 10.5 C 4 13.8, 6 16, 9 16 C 12 16, 14 13.8, 14 10.5 C 14 8, 12.5 7, 11 5 C 11 7, 10 8, 9 7.5 C 9 5, 9 3, 9 1.5 Z" />
  </Mark>
);

/* — Decorative corner stars ——————————————— */
const SketchSparkles = ({ className }) => (
  <svg viewBox="0 0 60 40" className={"sketch " + (className||"")} width="60" height="40" aria-hidden="true">
    <path d="M10 20 L 10 30 M5 25 L 15 25" />
    <path d="M40 10 L 40 18 M36 14 L 44 14" className="thin" />
    <path d="M50 28 L 50 34 M47 31 L 53 31" className="thin" />
  </svg>
);

Object.assign(window, {
  FerdinandMark, SketchCardStack, SketchPlant, SketchBook, SketchLeaf,
  SketchOwl, SketchCalendar, SketchSpark, SketchUnderline, SketchScribble,
  SketchCheck, SketchArrow, SketchClock, SketchGlobe, SketchLock,
  SketchMail, SketchPlus, SketchSearch, SketchGear, SketchUser, SketchFlame, SketchSparkles,
});
