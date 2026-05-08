/**
 * Phase A4-β: client-side auth store.
 *
 * Exposes a single `auth` singleton with `$state`-backed `user` / `status`
 * fields so any component can read `auth.user.username` or branch on
 * `auth.status === "authed"` and the read will participate in Svelte 5
 * reactivity. Methods (`bootstrap` / `login` / `logout` /
 * `handleUnauthorized`) own the transitions; templates never set
 * fields directly.
 *
 * State machine
 * -------------
 * - `unknown` — fresh load, bootstrap not yet called.
 * - `checking` — bootstrap in flight (one tick window).
 * - `authed`   — `/api/auth/me` returned a user, or `login()` succeeded.
 * - `anon`     — `/api/auth/me` returned 401, `logout()` ran, or any
 *                non-auth API call surfaced 401 via the `onUnauthorized`
 *                hook in api.ts.
 *
 * The +layout.svelte mount runs `auth.bootstrap()` and registers
 * `auth.handleUnauthorized()` with `setOnUnauthorized`. The route guard
 * then redirects to `/login?next=...` whenever `status === "anon"` and
 * the current route isn't `/login` itself.
 */

import { browser } from "$app/environment";
import { goto } from "$app/navigation";
import {
    fetchAuthMe,
    postAuthLogin,
    postAuthLogout,
    type ApiAuthMe,
} from "./api";

export type AuthStatus = "unknown" | "checking" | "authed" | "anon";

class AuthStore {
    user = $state<ApiAuthMe | null>(null);
    status = $state<AuthStatus>("unknown");

    // Memoise the in-flight bootstrap so a +layout.svelte that re-mounts
    // (HMR, navigation race) doesn't fire two parallel /api/auth/me calls.
    #bootstrapPromise: Promise<void> | null = null;

    async bootstrap(): Promise<void> {
        if (!browser) return;
        if (this.#bootstrapPromise) return this.#bootstrapPromise;
        this.status = "checking";
        this.#bootstrapPromise = (async () => {
            try {
                const me = await fetchAuthMe();
                if (me) {
                    this.user = me;
                    this.status = "authed";
                } else {
                    this.user = null;
                    this.status = "anon";
                }
            } catch {
                // Network error or non-401 server failure — treat as anon
                // so the user lands on /login rather than seeing a frozen
                // "checking…" shell.
                this.user = null;
                this.status = "anon";
            }
        })();
        return this.#bootstrapPromise;
    }

    async login(username: string, password: string): Promise<ApiAuthMe> {
        const me = await postAuthLogin(username, password);
        this.user = me;
        this.status = "authed";
        return me;
    }

    async logout(): Promise<void> {
        try {
            await postAuthLogout();
        } finally {
            this.user = null;
            this.status = "anon";
            if (browser) await goto("/login");
        }
    }

    /**
     * Called by api.ts when a non-auth API call returns 401. Clears local
     * state and bounces to /login with the current path encoded as
     * `?next=...` so the page restores after a successful login. Skips
     * the bounce when we're already on /login (login form's own
     * postAuthLogin failures route through `login()`'s thrown error
     * instead — they shouldn't reach here because the path is gated in
     * `fireOnUnauthorized`, but the early-return is a belt-and-braces
     * guard in case a future caller hits /api/auth/me from within /login).
     */
    handleUnauthorized(): void {
        this.user = null;
        this.status = "anon";
        if (!browser) return;
        if (window.location.pathname === "/login") return;
        const next = window.location.pathname + window.location.search;
        void goto(`/login?next=${encodeURIComponent(next)}`);
    }
}

export const auth = new AuthStore();
