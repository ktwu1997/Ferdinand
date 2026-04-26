// Stub for SvelteKit's virtual `$app/navigation` module so vitest can
// mount route components that call `goto`/`invalidate`/etc. Real-world
// navigation is replaced with a no-op promise so tests can either
// observe the call via `vi.mock("$app/navigation", ...)` or just let
// the code path complete without a runtime error.
// Reference: https://svelte.dev/docs/kit/$app-navigation

export async function goto(_url: string | URL): Promise<void> {
    // no-op
}

export async function invalidate(
    _resource?: string | URL | ((url: URL) => boolean),
): Promise<void> {
    // no-op
}

export async function invalidateAll(): Promise<void> {
    // no-op
}

export async function preloadData(_href: string): Promise<unknown> {
    return undefined;
}

export async function preloadCode(_url: string): Promise<void> {
    // no-op
}

export async function pushState(_url: string | URL, _state: unknown): Promise<void> {
    // no-op
}

export async function replaceState(_url: string | URL, _state: unknown): Promise<void> {
    // no-op
}

export const beforeNavigate = (): void => {};
export const afterNavigate = (): void => {};
export const onNavigate = (): void => {};
export const disableScrollHandling = (): void => {};

export const goto_ssr_redirect_default = false;
