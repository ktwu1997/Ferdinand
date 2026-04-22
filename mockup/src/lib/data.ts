/**
 * Fake data for the Phase-0 prototype.
 * Designer / real backend will replace this entirely.
 */

export interface Deck {
    id: string;
    name: string;
    emoji: string;
    new: number;
    learning: number;
    review: number;
    totalCards: number;
    lastStudied: string; // ISO date
    accent?: string;
}

export interface Card {
    id: string;
    deckId: string;
    front: string;
    back: string;
    tags: string[];
    due: string; // e.g. "2d", "12d", "now"
    state: "new" | "learning" | "review" | "suspended";
    ease?: number;
    interval?: number;
}

export interface DaySample {
    date: string;
    reviews: number;
    retention: number; // 0..1
}

export const decks: Deck[] = [
    {
        id: "jp-n2",
        name: "日文 N2",
        emoji: "🎌",
        new: 7,
        learning: 5,
        review: 19,
        totalCards: 2340,
        lastStudied: "2026-04-20",
    },
    {
        id: "rust",
        name: "Rust ownership",
        emoji: "🦀",
        new: 3,
        learning: 2,
        review: 8,
        totalCards: 412,
        lastStudied: "2026-04-19",
    },
    {
        id: "history",
        name: "World History",
        emoji: "📜",
        new: 0,
        learning: 0,
        review: 15,
        totalCards: 890,
        lastStudied: "2026-04-18",
    },
    {
        id: "anatomy",
        name: "Anatomy",
        emoji: "🫁",
        new: 12,
        learning: 3,
        review: 22,
        totalCards: 1567,
        lastStudied: "2026-04-17",
    },
    {
        id: "piano",
        name: "Piano theory",
        emoji: "🎹",
        new: 0,
        learning: 0,
        review: 0,
        totalCards: 203,
        lastStudied: "2026-04-10",
    },
];

export const cards: Card[] = [
    {
        id: "c1",
        deckId: "jp-n2",
        front: "森林",
        back: "しんりん — forest, woods",
        tags: ["N2", "名詞", "nature"],
        due: "now",
        state: "review",
        ease: 2.5,
        interval: 12,
    },
    {
        id: "c2",
        deckId: "jp-n2",
        front: "海",
        back: "うみ — sea, ocean",
        tags: ["N2", "名詞", "nature"],
        due: "5d",
        state: "review",
        ease: 2.6,
        interval: 45,
    },
    {
        id: "c3",
        deckId: "jp-n2",
        front: "山",
        back: "やま — mountain",
        tags: ["N2", "名詞"],
        due: "12d",
        state: "review",
    },
    {
        id: "c4",
        deckId: "jp-n2",
        front: "懐かしい",
        back: "なつかしい — nostalgic, dear, missed",
        tags: ["N2", "形容詞"],
        due: "2d",
        state: "learning",
    },
    {
        id: "c5",
        deckId: "rust",
        front: "What is a borrow checker error for this code?\n\nfn main() {\n  let s = String::from(\"hi\");\n  let r = &s;\n  let m = &mut s;\n  println!(\"{}\", r);\n}",
        back: "Cannot borrow `s` as mutable because it is also borrowed as immutable. The immutable borrow `r` is still in use at the `println!`.",
        tags: ["ownership", "borrow"],
        due: "now",
        state: "review",
    },
    {
        id: "c6",
        deckId: "rust",
        front: "Difference between Copy and Clone?",
        back: "Copy: implicit bitwise copy (fixed-size, stack-only). Clone: explicit, can allocate. All Copy types are Clone; converse is not true.",
        tags: ["traits"],
        due: "3d",
        state: "review",
    },
    {
        id: "c7",
        deckId: "history",
        front: "Date of the fall of Constantinople",
        back: "1453 — Mehmed II's Ottoman forces breached the walls on 29 May.",
        tags: ["byzantine", "ottoman"],
        due: "now",
        state: "review",
    },
    {
        id: "c8",
        deckId: "anatomy",
        front: "Which cranial nerve controls the tongue?",
        back: "Hypoglossal (CN XII).",
        tags: ["neuroanatomy"],
        due: "1d",
        state: "review",
    },
];

// last 30 days, deterministic for stable screenshots
export const history: DaySample[] = Array.from({ length: 30 }, (_, i) => {
    const d = new Date("2026-04-20");
    d.setDate(d.getDate() - (29 - i));
    const seed = (i * 9301 + 49297) % 233280;
    const base = 40 + Math.round((seed / 233280) * 60);
    const dip = i % 7 === 6 ? 0.6 : 1; // Sunday dip
    return {
        date: d.toISOString().slice(0, 10),
        reviews: Math.round(base * dip),
        retention: 0.85 + ((seed % 100) / 100) * 0.12,
    };
});

export const answerDistribution = {
    again: 84,
    hard: 132,
    good: 412,
    easy: 71,
};

export function totalDue(d: Deck): number {
    return d.new + d.learning + d.review;
}

export const savedSearches = [
    { id: "s1", name: "Leeches", query: "tag:leech" },
    { id: "s2", name: "Added today", query: "added:1" },
    { id: "s3", name: "Hard Rust", query: 'deck:"Rust ownership" rated:1:1' },
];

export const tags = [
    "N2",
    "名詞",
    "形容詞",
    "nature",
    "ownership",
    "borrow",
    "traits",
    "byzantine",
    "ottoman",
    "neuroanatomy",
];
