<script lang="ts">
    // Test-only harness: drives CardFace via `$state`-backed props so a
    // vitest spec can mutate html/css/testid post-mount and assert that
    // CardFace's `$effect` re-renders the shadow root. Lives next to
    // CardFace.svelte so vite-plugin-svelte picks it up with the same
    // resolve rules as the production component.
    //
    // `untrack` wraps the prop reads because we intentionally want a
    // one-time snapshot of the incoming props into local $state — after
    // mount the spec drives values via setHtml/setCss, not by re-mounting
    // with new props. Without untrack, Svelte's `state_referenced_locally`
    // warning (https://svelte.dev/e/state_referenced_locally) fires.
    import { untrack } from "svelte";

    import CardFace from "./CardFace.svelte";

    interface Props {
        initialHtml: string;
        initialCss: string;
        initialTestid?: string;
    }

    let { initialHtml, initialCss, initialTestid }: Props = $props();

    let html = $state<string>(untrack(() => initialHtml));
    let css = $state<string>(untrack(() => initialCss));
    let testid = $state<string | undefined>(untrack(() => initialTestid));

    export function setHtml(value: string): void {
        html = value;
    }

    export function setCss(value: string): void {
        css = value;
    }
</script>

<CardFace {html} {css} {testid} />
