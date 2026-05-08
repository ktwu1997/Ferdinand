<!--
  Phase A4-α visual smoke-test page. Renders all sketch primitives and
  every icon in the library so a screenshot tells us at a glance whether
  tokens, fonts, sketch SVG defaults, and primitive shadows landed.
  This route is INTENTIONALLY temporary — it's deleted at the end of
  Phase A4-β before the β commit.

  Path uses a leading underscore so the existing chrome-bearing layout
  treats it as a private surface (we still wrap in `.sketch-skin` to
  pull in the new tokens).
-->
<script lang="ts">
    import {
        Btn,
        Field,
        Caption,
        Chip,
        Panel,
        Divider,
    } from "$lib/components/ui";
    import {
        FerdinandMark,
        SketchOwl,
        SketchPlant,
        SketchBook,
        SketchCardStack,
        SketchLeaf,
        SketchCalendar,
        SketchSpark,
        SketchSparkles,
        SketchUnderline,
        SketchScribble,
        SketchCheck,
        SketchArrow,
        SketchClock,
        SketchGlobe,
        SketchLock,
        SketchMail,
        SketchPlus,
        SketchSearch,
        SketchGear,
        SketchUser,
        SketchFlame,
    } from "$lib/components/sketch";

    let demoEmail = $state("");
    let demoPassword = $state("");
    let demoServer = $state("https://localhost:40001");
    let theme = $state<"light" | "dark">("light");
    let owlClosed = $state(false);
    let owlGazeX = $derived(Math.min(demoEmail.length / 24, 1) * 9 - 5);
</script>

<div class="sketch-skin grain skin-page" data-theme={theme}>
    <header class="hdr">
        <div class="brand">
            <FerdinandMark size={36} />
            <div class="brand-meta">
                <div class="mono brand-name">Ferdinand</div>
                <div class="mono brand-tag">SPACED · REPETITION</div>
            </div>
        </div>
        <div class="controls">
            <Btn
                kind="paper"
                size="sm"
                id="toggle-theme"
                onclick={() => (theme = theme === "light" ? "dark" : "light")}
            >
                theme: {theme}
            </Btn>
            <Btn
                kind="ghost"
                size="sm"
                id="toggle-owl"
                onclick={() => (owlClosed = !owlClosed)}
            >
                owl: {owlClosed ? "asleep" : "awake"}
            </Btn>
        </div>
    </header>

    <section class="block">
        <Caption>buttons</Caption>
        <div class="row gap-12">
            <Btn kind="primary">primary</Btn>
            <Btn kind="paper">paper</Btn>
            <Btn kind="outline">outline</Btn>
            <Btn kind="ghost">ghost</Btn>
            <Btn kind="accent">accent</Btn>
        </div>
        <div class="row gap-12">
            <Btn kind="primary" size="sm">small</Btn>
            <Btn kind="primary" size="md">medium</Btn>
            <Btn kind="primary" size="lg">large</Btn>
            <Btn kind="primary" size="md">
                {#snippet leading()}<SketchPlus size={14} />{/snippet}
                add deck
            </Btn>
            <Btn kind="primary" size="md">
                sign in
                {#snippet trailing()}<SketchArrow size={18} />{/snippet}
            </Btn>
        </div>
    </section>

    <Divider />

    <section class="block">
        <Caption>captions</Caption>
        <div class="row gap-24 align-baseline">
            <Caption>session 01</Caption>
            <Caption>today</Caption>
            <Caption>deck.options</Caption>
            <Caption>answers</Caption>
            <Caption bare>// raw mono</Caption>
        </div>
    </section>

    <Divider />

    <section class="block">
        <Caption>chips</Caption>
        <div class="row gap-12">
            <Chip>n2 · jp</Chip>
            <Chip>tag:hard</Chip>
            <Chip color="var(--due)" bg="transparent">again</Chip>
            <Chip color="var(--warn)" bg="transparent">hard</Chip>
        </div>
    </section>

    <Divider />

    <section class="block fields">
        <Caption>fields</Caption>
        <div class="grid-2">
            <Panel padding="28px 32px">
                <Field
                    label="Server"
                    bind:value={demoServer}
                    mono
                    readonly
                    hint="// where your collection lives"
                >
                    {#snippet leading()}<SketchGlobe />{/snippet}
                </Field>
                <Field
                    label="Email"
                    bind:value={demoEmail}
                    placeholder="you@domain.com"
                    type="email"
                >
                    {#snippet leading()}<SketchMail />{/snippet}
                </Field>
                <Field
                    label="Password"
                    bind:value={demoPassword}
                    type="password"
                    placeholder="••••••••••"
                >
                    {#snippet leading()}<SketchLock />{/snippet}
                    {#snippet optional()}
                        <button
                            type="button"
                            class="muted-link"
                            onclick={() => {}}
                        >
                            forgot?
                        </button>
                    {/snippet}
                </Field>
                <Btn kind="primary" size="lg" block>
                    sign in
                    {#snippet trailing()}<SketchArrow />{/snippet}
                </Btn>
            </Panel>

            <Panel stack padding="28px 32px">
                <div class="card-head">
                    <Caption>02 · index card</Caption>
                    <SketchLeaf size={32} />
                </div>
                <h3 class="card-h cjk">日本語の単語</h3>
                <div class="card-rule"></div>
                <p class="card-meaning cjk">
                    a placeholder card front rendered through the kraft-paper
                    panel — note the rotated sibling underneath.
                </p>
                <div class="row gap-8">
                    <Chip>n2</Chip>
                    <Chip>vocab</Chip>
                </div>
            </Panel>
        </div>
    </section>

    <Divider />

    <section class="block">
        <Caption>sketch icons</Caption>
        <div class="icon-grid">
            <div class="icon"><FerdinandMark size={36} /><span class="mono lbl">brand</span></div>
            <div class="icon"><SketchOwl size={120} closed={owlClosed} gazeX={owlGazeX} /><span class="mono lbl">owl</span></div>
            <div class="icon"><SketchPlant size={100} /><span class="mono lbl">plant</span></div>
            <div class="icon"><SketchBook size={100} /><span class="mono lbl">book</span></div>
            <div class="icon"><SketchCardStack size={120} /><span class="mono lbl">stack</span></div>
            <div class="icon"><SketchCalendar size={80} /><span class="mono lbl">calendar</span></div>
            <div class="icon"><SketchLeaf size={36} /><span class="mono lbl">leaf</span></div>
            <div class="icon"><SketchSpark size={28} /><span class="mono lbl">spark</span></div>
            <div class="icon"><SketchSparkles /><span class="mono lbl">sparkles</span></div>
        </div>
        <div class="row gap-18">
            <span class="icon-row"><SketchCheck /><span>check</span></span>
            <span class="icon-row"><SketchArrow /><span>arrow</span></span>
            <span class="icon-row"><SketchClock /><span>clock</span></span>
            <span class="icon-row"><SketchGlobe /><span>globe</span></span>
            <span class="icon-row"><SketchLock /><span>lock</span></span>
            <span class="icon-row"><SketchMail /><span>mail</span></span>
            <span class="icon-row"><SketchPlus /><span>plus</span></span>
            <span class="icon-row"><SketchSearch /><span>search</span></span>
            <span class="icon-row"><SketchGear /><span>gear</span></span>
            <span class="icon-row"><SketchUser /><span>user</span></span>
            <span class="icon-row"><SketchFlame /><span>flame</span></span>
        </div>
        <div class="row gap-24 align-center">
            <SketchUnderline width={140} />
            <SketchScribble width={120} />
        </div>
    </section>

    <Divider />

    <section class="block">
        <Caption>typography</Caption>
        <div class="type-stack">
            <h1 class="type-hero mono">Quiet pages, long memory.</h1>
            <h2 class="type-h mono">deck options</h2>
            <p class="type-body">
                Body text in Geist — the warm sans for chrome and copy.
                Body uses Geist; metadata uses JetBrains Mono.
            </p>
            <p class="type-cjk cjk">日本語のテスト · 繁體中文測試</p>
            <p class="hand">a hand-scribbled aside in caveat.</p>
        </div>
    </section>

    <footer class="ftr mono">
        <span>v0.1.0 · selfhost</span>
        <span>NO TELEMETRY</span>
        <span>α design system smoke-test</span>
    </footer>
</div>

<style>
    .skin-page {
        min-height: 100vh;
        padding: 48px clamp(20px, 5vw, 64px);
        display: flex;
        flex-direction: column;
        gap: 28px;
    }
    .hdr {
        display: flex;
        justify-content: space-between;
        align-items: center;
    }
    .brand {
        display: inline-flex;
        align-items: center;
        gap: 12px;
    }
    .brand-meta {
        display: flex;
        flex-direction: column;
        line-height: 1;
    }
    .brand-name {
        font-size: 18px;
        font-weight: 600;
        letter-spacing: 0.02em;
    }
    .brand-tag {
        font-size: 10px;
        letter-spacing: 0.18em;
        color: var(--ink-mute);
        margin-top: 4px;
    }
    .controls {
        display: inline-flex;
        gap: 8px;
    }
    .block {
        display: flex;
        flex-direction: column;
        gap: 14px;
    }
    .row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
    }
    .gap-8 { gap: 8px; }
    .gap-12 { gap: 12px; }
    .gap-18 { gap: 18px; }
    .gap-24 { gap: 24px; }
    .align-baseline { align-items: baseline; }
    .align-center { align-items: center; }
    .grid-2 {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 28px;
    }
    @media (max-width: 720px) {
        .grid-2 { grid-template-columns: 1fr; }
    }
    .muted-link {
        color: var(--accent);
        font-size: 11px;
        text-decoration: none;
        background: none;
        border: 0;
        padding: 0;
        cursor: pointer;
        font-family: var(--font-mono);
    }
    .card-head {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        margin-bottom: 14px;
    }
    .card-h {
        font-family: var(--font-cjk);
        font-size: 36px;
        margin: 4px 0 14px;
        letter-spacing: 0.02em;
    }
    .card-rule {
        border-top: 1px dashed var(--rule);
        margin: 10px 0 14px;
    }
    .card-meaning {
        color: var(--ink-soft);
        font-size: 14px;
        line-height: 1.55;
        margin-bottom: 16px;
    }
    .icon-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
        gap: 18px;
        align-items: end;
    }
    .icon {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
        color: var(--ink);
    }
    .lbl {
        font-size: 10px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--ink-mute);
    }
    .icon-row {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-family: var(--font-mono);
        font-size: 11px;
        color: var(--ink-soft);
    }
    .type-stack {
        display: flex;
        flex-direction: column;
        gap: 10px;
        max-width: 640px;
    }
    .type-hero {
        font-size: clamp(28px, 4vw, 44px);
        margin: 0;
        line-height: 1.15;
        letter-spacing: -0.01em;
    }
    .type-h {
        font-size: 22px;
        margin: 0;
    }
    .type-body {
        font-family: var(--font-sans);
        font-size: 15px;
        color: var(--ink-soft);
        margin: 0;
    }
    .type-cjk {
        font-size: 22px;
        line-height: 1.4;
        margin: 0;
    }
    .ftr {
        display: flex;
        justify-content: space-between;
        gap: 24px;
        font-size: 10px;
        letter-spacing: 0.18em;
        color: var(--ink-mute);
        border-top: 1px dashed var(--rule);
        padding-top: 24px;
        margin-top: auto;
    }
</style>
