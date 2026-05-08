<!--
  Phase A4-β /login page.

  Visual reference: design_handoff_ferdinand/source/login.jsx (LoginV1 +
  LoginMobile) and design_handoff_ferdinand/screenshots/01-login.png.

  Route is in +layout.svelte's `fullscreenRoutes` (Phase A4-α) so the
  legacy cream chrome stays out of the way and the sketch-skin renders
  edge-to-edge. The page wraps its root in `.sketch-skin .grain` so all
  `var(--ink) / var(--paper) / var(--accent)` reads resolve to the
  kraft-paper palette in styles/tokens.css; if a future page wraps the
  same way it gets the same look without a CSS rewrite.

  Server contract: anki_server's `/api/auth/login` validates `username`
  as lowercase a-z 0-9 _ - (3..=64 chars) — NOT an email. The field is
  labelled "username" so the form can't lie about what the server
  accepts. Owl gaze tracking still keys off the field's character
  count exactly like the design (email empty → idle, focused/typing →
  pupils sweep -5 → +4 over the first 24 chars).
-->
<script lang="ts">
    import { onMount } from "svelte";
    import { browser } from "$app/environment";
    import { goto } from "$app/navigation";
    import { page } from "$app/stores";
    import { Btn, Field, Caption } from "$lib/components/ui";
    import {
        FerdinandMark,
        SketchOwl,
        SketchPlant,
        SketchSparkles,
        SketchUnderline,
        SketchArrow,
        SketchCheck,
        SketchUser,
        SketchLock,
        SketchGlobe,
    } from "$lib/components/sketch";
    import { auth } from "$lib/auth.svelte";

    // Form state — Svelte 5 runes mirror of the React `useOwl` hook.
    let username = $state("");
    let password = $state("");
    let usernameFocus = $state(false);
    let pwFocus = $state(false);
    let keepSignedIn = $state(true);
    let submitting = $state(false);
    let errorMessage = $state<string | null>(null);

    // Owl gaze derives from the username field, not the password — typing
    // the username should feel like the owl is reading along; password
    // focus closes its eyes (cute + privacy signal).
    const MAX = 24;
    let tracking = $derived(usernameFocus || username.length > 0);
    let t = $derived(Math.min(username.length / MAX, 1));
    let gazeX = $derived(tracking ? -5 + t * 9 : 0);
    let gazeY = $derived(tracking ? 2 : 0);
    let owlClosed = $derived(pwFocus);

    // Server endpoint hint. SSR-safe — falls back to a placeholder so the
    // page hydrates without flashing the wrong host. The field is
    // readonly because anki_server is bound to whatever origin the user
    // landed on; offering an editable input here would be a lie.
    let serverHint = $state("loading…");
    onMount(() => {
        serverHint = window.location.origin;
        // Already authed (e.g. user typed /login while signed in) — bounce
        // to next or home so they don't sit on a redundant login form.
        if (auth.status === "authed") {
            void goto(decodeNext($page.url.searchParams.get("next")));
        }
    });

    // The route guard never lets the user land on /login while authed,
    // but a successful submit still needs the same `next` decoder so the
    // post-login redirect lands them where they tried to go.
    function decodeNext(raw: string | null): string {
        if (!raw) return "/";
        // Reject open-redirect attempts: only allow same-origin paths
        // starting with a single `/` (and not `//host` schemeless URLs).
        if (!raw.startsWith("/") || raw.startsWith("//")) return "/";
        return raw;
    }

    async function onSubmit(event: Event) {
        event.preventDefault();
        if (submitting) return;
        errorMessage = null;
        const trimmedUser = username.trim();
        if (!trimmedUser || !password) {
            errorMessage = "username and password required";
            return;
        }
        submitting = true;
        try {
            await auth.login(trimmedUser, password);
            const next = decodeNext($page.url.searchParams.get("next"));
            await goto(next);
        } catch (err) {
            const raw = err instanceof Error ? err.message : "login failed";
            errorMessage = humaniseAuthError(raw);
        } finally {
            submitting = false;
        }
    }

    // Server surfaces "<status> <message>" via api.ts's jsonRequest. Strip
    // the leading status code so the inline caption reads like a sentence,
    // and lowercase to match the rest of the sketch typography.
    function humaniseAuthError(raw: string): string {
        const stripped = raw.replace(/^\d{3}\s+/, "").trim();
        if (!stripped) return "login failed";
        return stripped.toLowerCase();
    }
</script>

<svelte:head>
    <title>Sign in · Ferdinand</title>
</svelte:head>

<div class="sketch-skin grain login-root" data-testid="login-root">
    <!-- Desktop split (≥1024). Self-hides on phone via media queries. -->
    <div class="login-desktop">
        <!-- LEFT — illustration panel -->
        <aside class="login-art">
            <div class="logo-mark">
                <FerdinandMark size={36} />
                <div class="logo-text">
                    <div class="logo-name mono">Ferdinand</div>
                    <div class="logo-sub mono">SPACED · REPETITION</div>
                </div>
            </div>

            <div class="art-stage">
                <div class="art-sparkle"><SketchSparkles /></div>
                <SketchOwl size={220} closed={owlClosed} />
                <div class="art-plant"><SketchPlant size={120} /></div>

                <div class="art-headline">
                    <h1>
                        Quiet pages,<br />
                        <span class="headline-underlined">
                            long memory.
                            <span class="headline-underline">
                                <SketchUnderline width={210} />
                            </span>
                        </span>
                    </h1>
                    <p>
                        A single-user Anki rebuild. Local first, sync
                        optional, no add-ons, no AnkiWeb. Your collection
                        lives on your own server.
                    </p>
                </div>
            </div>

            <div class="art-foot mono">
                <span>→ rust core</span>
                <span>→ fsrs scheduler</span>
                <span>→ sveltekit</span>
            </div>
        </aside>

        <!-- RIGHT — form -->
        <section class="login-form-pane">
            <form class="login-form" onsubmit={onSubmit} novalidate>
                <Caption>session 01</Caption>
                <h2 class="form-title">sign in</h2>
                <p class="form-sub">Connect to your Ferdinand sync server.</p>

                <Field
                    label="Server"
                    value={serverHint}
                    readonly
                    mono
                    hint="Where your collection lives."
                >
                    {#snippet leading()}<SketchGlobe />{/snippet}
                </Field>

                <Field
                    label="Username"
                    bind:value={username}
                    placeholder="ktwu"
                    autocomplete="username"
                    name="username"
                    id="login-username"
                    onfocus={() => (usernameFocus = true)}
                    onblur={() => (usernameFocus = false)}
                >
                    {#snippet leading()}<SketchUser />{/snippet}
                </Field>

                <Field
                    label="Password"
                    type="password"
                    bind:value={password}
                    placeholder="••••••••••"
                    autocomplete="current-password"
                    name="password"
                    id="login-password"
                    onfocus={() => (pwFocus = true)}
                    onblur={() => (pwFocus = false)}
                >
                    {#snippet leading()}<SketchLock />{/snippet}
                </Field>

                <label class="keep-row mono">
                    <input
                        type="checkbox"
                        bind:checked={keepSignedIn}
                        class="keep-checkbox"
                    />
                    <span class="keep-icon"><SketchCheck size={18} /></span>
                    keep this device signed in
                </label>

                {#if errorMessage}
                    <div class="error-line mono" role="alert" data-testid="login-error">
                        // {errorMessage}
                    </div>
                {/if}

                <div class="cta-row">
                    <Btn
                        kind="primary"
                        size="lg"
                        type="submit"
                        disabled={submitting}
                        data-testid="login-submit"
                    >
                        {#snippet trailing()}<SketchArrow />{/snippet}
                        {submitting ? "signing in…" : "sign in"}
                    </Btn>
                    <button type="button" class="local-link mono" disabled aria-disabled="true">
                        run local-only
                    </button>
                </div>

                <div class="foot-meta mono">
                    <span>v0.1.0 · selfhost</span>
                    <span>NO TELEMETRY</span>
                </div>
            </form>
        </section>
    </div>

    <!-- Mobile (≤640). Mirrors LoginMobile — stacked, owl above form. -->
    <div class="login-mobile">
        <header class="m-header">
            <div class="logo-mark">
                <FerdinandMark size={32} />
                <div class="logo-text">
                    <div class="logo-name mono">Ferdinand</div>
                    <div class="logo-sub mono">SPACED · REPETITION</div>
                </div>
            </div>
        </header>
        <div class="m-owl">
            <div class="m-sparkle"><SketchSparkles /></div>
            <SketchOwl size={160} {gazeX} {gazeY} closed={owlClosed} />
        </div>
        <form class="login-form m-form" onsubmit={onSubmit} novalidate>
            <Caption>session 01</Caption>
            <h2 class="form-title">sign in</h2>
            <p class="form-sub">connect to your sync server.</p>

            <Field label="Server" value={serverHint} readonly mono>
                {#snippet leading()}<SketchGlobe />{/snippet}
            </Field>
            <Field
                label="Username"
                bind:value={username}
                placeholder="ktwu"
                autocomplete="username"
                onfocus={() => (usernameFocus = true)}
                onblur={() => (usernameFocus = false)}
            >
                {#snippet leading()}<SketchUser />{/snippet}
            </Field>
            <Field
                label="Password"
                type="password"
                bind:value={password}
                placeholder="••••••••••"
                autocomplete="current-password"
                onfocus={() => (pwFocus = true)}
                onblur={() => (pwFocus = false)}
            >
                {#snippet leading()}<SketchLock />{/snippet}
            </Field>

            {#if errorMessage}
                <div class="error-line mono" role="alert">// {errorMessage}</div>
            {/if}

            <Btn
                kind="primary"
                size="lg"
                type="submit"
                disabled={submitting}
                block
            >
                {#snippet trailing()}<SketchArrow />{/snippet}
                {submitting ? "signing in…" : "sign in"}
            </Btn>

            <div class="m-foot mono">
                <span>v0.1.0</span>
                <span>SELFHOSTED · NO TELEMETRY</span>
            </div>
        </form>
    </div>

    <!-- corner build tag -->
    <div class="corner-tag mono" aria-hidden="true">[ FERDINAND // M4 SYNC ]</div>
</div>

<style>
    .login-root {
        position: relative;
        min-height: 100vh;
        min-height: 100dvh;
        background: var(--bg);
        color: var(--ink);
        overflow-x: hidden;
    }

    /* Desktop split — visible ≥641px, hidden on phone. */
    .login-desktop {
        display: grid;
        grid-template-columns: 46% 1fr;
        min-height: 100vh;
        min-height: 100dvh;
    }
    @media (max-width: 640px) {
        .login-desktop {
            display: none;
        }
    }

    .login-art {
        position: relative;
        background: var(--bg-soft);
        border-right: 1.5px solid var(--ink);
        padding: 56px 64px;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
    }
    .logo-mark {
        display: inline-flex;
        align-items: center;
        gap: 10px;
    }
    .logo-text {
        display: flex;
        flex-direction: column;
        line-height: 1;
    }
    .logo-name {
        font-size: 18px;
        font-weight: 600;
        letter-spacing: 0.02em;
    }
    .logo-sub {
        font-size: 10px;
        letter-spacing: 0.18em;
        color: var(--ink-mute);
        margin-top: 4px;
    }
    .art-stage {
        position: relative;
    }
    .art-sparkle {
        position: absolute;
        top: -28px;
        left: -8px;
        color: var(--accent);
    }
    .art-plant {
        position: absolute;
        right: 40px;
        top: 30px;
    }
    .art-headline {
        margin-top: 28px;
        max-width: 460px;
    }
    .art-headline h1 {
        font-family: var(--font-mono);
        font-weight: 500;
        font-size: 34px;
        line-height: 1.2;
        letter-spacing: -0.01em;
        margin: 0;
    }
    .headline-underlined {
        position: relative;
    }
    .headline-underline {
        position: absolute;
        left: 0;
        bottom: -10px;
    }
    .art-headline p {
        margin-top: 28px;
        font-size: 15px;
        color: var(--ink-soft);
        line-height: 1.6;
        max-width: 420px;
    }
    .art-foot {
        font-size: 11px;
        color: var(--ink-mute);
        letter-spacing: 0.1em;
        display: flex;
        gap: 16px;
    }

    .login-form-pane {
        padding: 72px 88px;
        display: flex;
        flex-direction: column;
        justify-content: center;
    }
    .login-form {
        max-width: 380px;
        width: 100%;
    }
    .form-title {
        font-family: var(--font-mono);
        font-weight: 600;
        font-size: 28px;
        margin: 12px 0 6px;
    }
    .form-sub {
        color: var(--ink-soft);
        font-size: 14px;
        margin-bottom: 36px;
    }

    .keep-row {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 28px;
        margin-top: 8px;
        font-size: 12px;
        color: var(--ink-soft);
        letter-spacing: 0.04em;
        cursor: pointer;
        user-select: none;
    }
    /* Hide the native checkbox visually but keep it focusable so keyboard
       users can still toggle the preference. The SketchCheck icon is the
       visible affordance — its filled/empty state isn't synced (single-
       user honour-system flag) so the icon stays as-is. */
    .keep-checkbox {
        position: absolute;
        opacity: 0;
        width: 1px;
        height: 1px;
        pointer-events: none;
    }
    .keep-icon {
        display: inline-flex;
    }

    .error-line {
        font-size: 12px;
        color: var(--accent-warm, #b3461d);
        letter-spacing: 0.04em;
        margin: -8px 0 16px;
    }

    .cta-row {
        display: flex;
        align-items: center;
        gap: 14px;
    }
    .local-link {
        background: none;
        border: 0;
        font: inherit;
        font-family: var(--font-mono);
        font-size: 12px;
        color: var(--ink-soft);
        text-decoration: underline;
        text-underline-offset: 4px;
        letter-spacing: 0.04em;
        cursor: not-allowed;
        opacity: 0.55;
    }
    .foot-meta {
        display: flex;
        justify-content: space-between;
        font-size: 10px;
        color: var(--ink-mute);
        letter-spacing: 0.1em;
        padding-top: 24px;
        border-top: 1px dashed var(--rule);
        margin-top: 24px;
    }

    /* Mobile stack — visible ≤640px, hidden on desktop. */
    .login-mobile {
        display: none;
    }
    @media (max-width: 640px) {
        .login-mobile {
            display: flex;
            flex-direction: column;
            min-height: 100vh;
            min-height: 100dvh;
            padding: 56px 28px 32px;
        }
    }
    .m-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
    }
    .m-owl {
        margin-top: 32px;
        position: relative;
        display: flex;
        justify-content: center;
    }
    .m-sparkle {
        position: absolute;
        top: 0;
        right: 24px;
        color: var(--accent);
    }
    .m-form {
        margin-top: 16px;
        max-width: none;
    }
    .m-foot {
        margin-top: auto;
        padding-top: 24px;
        display: flex;
        justify-content: space-between;
        border-top: 1px dashed var(--rule);
        font-size: 10px;
        color: var(--ink-mute);
        letter-spacing: 0.14em;
    }

    .corner-tag {
        position: absolute;
        top: 18px;
        right: 24px;
        font-size: 10px;
        color: var(--ink-mute);
        letter-spacing: 0.18em;
        pointer-events: none;
    }
    @media (max-width: 640px) {
        .corner-tag {
            top: 12px;
            right: 16px;
        }
    }
</style>
