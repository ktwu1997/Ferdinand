import { vi } from "vitest";

// Phase B-test-fix: jsdom does not implement window.matchMedia, so any
// component that subscribes to a media query at module-eval or onMount
// time (e.g. /settings reading prefers-color-scheme) throws "matchMedia
// is not a function" and explodes the whole test file. The polyfill
// returns a static "no match" MediaQueryList — tests that need to
// exercise a specific match override per-test with vi.mocked or by
// re-stubbing the listener.
Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
    })),
});
