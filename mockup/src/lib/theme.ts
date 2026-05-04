import { browser } from "$app/environment";

export type Theme = "light" | "dark";
export type ThemeChoice = "light" | "dark" | "auto";

const STORAGE_KEY = "theme";

function systemPrefersDark(): boolean {
    if (!browser) return false;
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function resolveChoice(choice: ThemeChoice): Theme {
    if (choice === "auto") return systemPrefersDark() ? "dark" : "light";
    return choice;
}

function applyTheme(theme: Theme): void {
    if (!browser) return;
    document.documentElement.dataset.theme = theme;
}

export function getTheme(): Theme {
    if (!browser) return "light";
    const attr = document.documentElement.dataset.theme;
    return attr === "dark" ? "dark" : "light";
}

export function getThemeChoice(): ThemeChoice {
    if (!browser) return "light";
    try {
        const v = localStorage.getItem(STORAGE_KEY);
        if (v === "light" || v === "dark" || v === "auto") return v;
    } catch (_) {
        // localStorage may be unavailable
    }
    return "light";
}

export function setTheme(theme: Theme): void {
    if (!browser) return;
    applyTheme(theme);
    try {
        localStorage.setItem(STORAGE_KEY, theme);
    } catch (_) {
        // localStorage may be unavailable in private mode
    }
}

export function setThemeChoice(choice: ThemeChoice): void {
    if (!browser) return;
    applyTheme(resolveChoice(choice));
    try {
        localStorage.setItem(STORAGE_KEY, choice);
    } catch (_) {
        // ignore
    }
}

export function toggleTheme(): Theme {
    const next = getTheme() === "dark" ? "light" : "dark";
    setTheme(next);
    return next;
}

// Re-resolve on OS preference change while user is in "auto" mode.
if (browser) {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener?.("change", () => {
        if (getThemeChoice() === "auto") applyTheme(resolveChoice("auto"));
    });
}
