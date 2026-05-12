<!--
  /login page — rev 2 design.

  Visual reference: design_handoff_ferdinand/source/login.jsx (LoginV1 +
  LoginMobile) and design_handoff_ferdinand/screenshots/01-login.png.

  Rev 2 collapsed the old two-pane split (art panel + form pane) into a
  single centered column shared verbatim by desktop and mobile — only the
  owl size and form width differ. Top: centered logo mark. Middle: owl
  above the form (gaze tracks the credential field, eyes close on password
  focus). Bottom: dashed-rule footer with the build tag. The server
  endpoint field is gone — sync server URL now lives in Settings → Sync
  only (rev 2 note).

  Route is in +layout.svelte's `fullscreenRoutes` so the legacy cream
  chrome stays out and `.sketch-skin .grain` resolves `var(--ink) /
  var(--paper) / var(--accent)` to the kraft-paper palette.

  Server contract note: anki_server's `/api/auth/login` validates
  `username` as lowercase a-z 0-9 _ - (3..=64 chars) — NOT an email.
  The design labels this field "Email", but we keep it labelled
  "Username" so the form can't lie about what the server accepts; the
  owl gaze still keys off its character count exactly like the design
  (idle when empty, pupils sweep -5 → +4 over the first 24 chars).
-->
<script lang="ts">
    import { onMount } from "svelte";
    import { goto } from "$app/navigation";
    import { page } from "$app/stores";
    import { Btn, Field, Caption } from "$lib/components/ui";
    import {
        FerdinandMark,
        SketchOwl,
        SketchArrow,
        SketchUser,
        SketchLock,
    } from "$lib/components/sketch";
    import { auth } from "$lib/auth.svelte";

    // Form state — Svelte 5 runes mirror of the React `useOwl` hook.
    let username = $state("");
    let password = $state("");
    let usernameFocus = $state(false);
    let pwFocus = $state(false);
    let submitting = $state(false);
    let errorMessage = $state<string | null>(null);

    // Owl gaze derives from the credential field, not the password — typing
    // the username should feel like the owl is reading along; password
    // focus closes its eyes (cute + privacy signal).
    const MAX = 24;
    let tracking = $derived(usernameFocus || username.length > 0);
    let t = $derived(Math.min(username.length / MAX, 1));
    let gazeX = $derived(tracking ? -5 + t * 9 : 0);
    let gazeY = $derived(tracking ? 2 : 0);
    let owlClosed = $derived(pwFocus);

    onMount(() => {
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
    <div class="login-shell">
        <!-- Centered logo mark — same on desktop + mobile. -->
        <header class="login-logo">
            <FerdinandMark size={36} />
            <div class="logo-text">
                <div class="logo-name mono">Ferdinand</div>
                <div class="logo-sub mono">SPACED · REPETITION</div>
            </div>
        </header>

        <!-- Centered owl + form. Single body, scaled by viewport via CSS. -->
        <main class="login-main">
            <form class="login-body" onsubmit={onSubmit} novalidate>
                <div class="owl-wrap">
                    <SketchOwl size={200} {gazeX} {gazeY} closed={owlClosed} />
                </div>

                <!-- Heading block above the form — matches the design's
                     "// session 01 / sign in / connect to your sync server."
                     copy that sits between the owl and the first field. -->
                <div class="login-heading">
                    <Caption>session 01</Caption>
                    <h1 class="login-h1 mono">sign in</h1>
                    <p class="login-tagline mono">connect to your sync server.</p>
                </div>

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
                    {#snippet optional()}
                        <!-- No password-reset flow yet (single-user, server-
                             managed credentials); the link is here for visual
                             parity with the handoff and is intentionally inert. -->
                        <button
                            type="button"
                            class="forgot-link"
                            aria-disabled="true"
                            title="contact your server admin to reset"
                            onclick={(e) => e.preventDefault()}
                        >
                            forgot?
                        </button>
                    {/snippet}
                </Field>

                {#if errorMessage}
                    <div
                        class="error-line mono"
                        role="alert"
                        data-testid="login-error"
                    >
                        {errorMessage}
                    </div>
                {/if}

                <div class="cta-primary">
                    <Btn
                        kind="primary"
                        size="lg"
                        type="submit"
                        block
                        disabled={submitting}
                        data-testid="login-submit"
                    >
                        {#snippet trailing()}<SketchArrow />{/snippet}
                        {submitting ? "signing in…" : "sign in"}
                    </Btn>
                </div>
                <div class="cta-secondary">
                    <Btn
                        kind="ghost"
                        size="md"
                        type="button"
                        block
                        disabled
                        aria-disabled="true"
                    >
                        run local-only
                    </Btn>
                </div>
            </form>
        </main>

        <footer class="login-foot mono">
            <span>v0.1.0 · selfhosted</span>
            <span>NO TELEMETRY</span>
        </footer>
    </div>
</div>

<style>
    .login-root {
        min-height: 100vh;
        min-height: 100dvh;
        background: var(--bg);
        color: var(--ink);
        display: flex;
        flex-direction: column;
        overflow-x: hidden;
    }

    /* Single centered column. max-width keeps the form from drifting too
       far from the footer rule on ultrawide screens; the form itself is
       further capped below. */
    .login-shell {
        flex: 1;
        width: 100%;
        max-width: 720px;
        margin: 0 auto;
        display: flex;
        flex-direction: column;
        padding: 44px 64px 32px;
    }
    @media (max-width: 640px) {
        .login-shell {
            padding: 56px 28px 32px;
        }
    }

    .login-logo {
        display: flex;
        align-items: center;
        justify-content: center;
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

    .login-main {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
    }
    .login-body {
        width: 100%;
        max-width: 420px;
        margin: 0 auto;
        display: flex;
        flex-direction: column;
    }
    @media (max-width: 640px) {
        .login-body {
            max-width: 340px;
        }
    }
    .owl-wrap {
        display: flex;
        justify-content: center;
        margin-bottom: 20px;
    }
    .login-heading {
        margin-bottom: 26px;
    }
    .login-h1 {
        font-size: 30px;
        font-weight: 600;
        letter-spacing: -0.02em;
        margin: 6px 0 8px;
        color: var(--ink);
        line-height: 1.05;
    }
    .login-tagline {
        font-size: 13px;
        color: var(--ink-mute);
        margin: 0;
    }
    @media (max-width: 640px) {
        .login-h1 {
            font-size: 26px;
        }
    }
    /* Match the design's smaller mobile owl without re-passing a prop. */
    @media (max-width: 640px) {
        .owl-wrap :global(svg) {
            width: 160px;
            height: 160px;
        }
    }

    .forgot-link {
        background: none;
        border: 0;
        padding: 0;
        font: inherit;
        font-size: 11px;
        color: var(--accent);
        cursor: pointer;
    }
    .forgot-link:hover {
        text-decoration: underline;
        text-underline-offset: 3px;
    }

    .error-line {
        font-size: 12px;
        color: var(--accent-warm, #b3461d);
        letter-spacing: 0.04em;
        margin: -8px 0 16px;
    }

    /* Design: primary btn marginTop 12, ghost btn marginTop 8. The Field
       primitive already carries its own 18px bottom margin. */
    .cta-primary {
        margin-top: 12px;
    }
    .cta-secondary {
        margin-top: 8px;
    }

    .login-foot {
        padding-top: 20px;
        border-top: 1px dashed var(--rule);
        display: flex;
        justify-content: space-between;
        font-size: 10px;
        color: var(--ink-mute);
        letter-spacing: 0.14em;
    }
</style>
