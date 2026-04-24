// Stub for SvelteKit's virtual `$app/stores` module so vitest can mount
// route components (`+page.svelte`) that subscribe to `$page`. Like
// `app-environment.ts`, a missing named export is a runtime `undefined`,
// so keep this aligned with whatever `$app/stores` named exports the
// components under test actually destructure.
// Reference: https://svelte.dev/docs/kit/$app-stores
import { writable, type Readable } from "svelte/store";

type PageState = {
    params: Record<string, string>;
    url: URL;
    route: { id: string | null };
    status: number;
    error: Error | null;
    data: Record<string, unknown>;
    form: unknown;
    state: Record<string, unknown>;
};

const defaultState: PageState = {
    params: {},
    url: new URL("http://localhost/"),
    route: { id: null },
    status: 200,
    error: null,
    data: {},
    form: null,
    state: {},
};

const _page = writable<PageState>({ ...defaultState });

export const page: Readable<PageState> = {
    subscribe: _page.subscribe,
};

export function setPageParams(params: Record<string, string>): void {
    _page.update((s) => ({ ...s, params }));
}

export function resetPageStub(): void {
    _page.set({ ...defaultState });
}

export const navigating: Readable<null> = {
    subscribe: writable<null>(null).subscribe,
};

export const updated: Readable<boolean> = {
    subscribe: writable<boolean>(false).subscribe,
};
