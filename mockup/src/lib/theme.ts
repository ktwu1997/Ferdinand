import { browser } from "$app/environment";

export type Theme = "light" | "dark";

export function getTheme(): Theme {
    if (!browser) return "light";
    const attr = document.documentElement.dataset.theme;
    return attr === "dark" ? "dark" : "light";
}

export function setTheme(theme: Theme): void {
    if (!browser) return;
    document.documentElement.dataset.theme = theme;
    try {
        localStorage.setItem("theme", theme);
    } catch (_) {
        // localStorage may be unavailable in private mode
    }
}

export function toggleTheme(): Theme {
    const next = getTheme() === "dark" ? "light" : "dark";
    setTheme(next);
    return next;
}
