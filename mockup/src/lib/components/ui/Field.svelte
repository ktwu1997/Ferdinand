<!--
  Bottom-bordered field — mirrors primitives.jsx <Field>. Mono uppercase
  label on top, optional leading icon snippet, an optional `optional`
  snippet for "forgot?" / inline help, and an underline-only input. Use
  `mono` to switch the input to JetBrains Mono (server endpoint, etc.).

  Fully controlled via `bind:value`. When `readonly` is true the input
  still renders but doesn't accept keystrokes — used by /login's server
  endpoint field where the value is fixed to window.location.origin in
  Phase A4-β.
-->
<script lang="ts">
    import type { Snippet } from "svelte";
    import type { HTMLInputAttributes } from "svelte/elements";

    interface Props {
        label: string;
        value?: string;
        placeholder?: string;
        type?: string;
        mono?: boolean;
        readonly?: boolean;
        autocomplete?: HTMLInputAttributes["autocomplete"];
        name?: string;
        id?: string;
        leading?: Snippet;
        optional?: Snippet;
        hint?: string;
        onfocus?: (e: FocusEvent) => void;
        onblur?: (e: FocusEvent) => void;
        oninput?: (e: Event) => void;
    }

    let {
        label,
        value = $bindable(""),
        placeholder,
        type = "text",
        mono = false,
        readonly = false,
        autocomplete,
        name,
        id,
        leading,
        optional,
        hint,
        onfocus,
        onblur,
        oninput,
    }: Props = $props();
</script>

<label class="field" for={id}>
    <div class="field-row">
        <span class="field-label mono">{label}</span>
        {#if optional}
            <span class="field-optional">{@render optional()}</span>
        {/if}
    </div>
    <div class="field-input-row" class:readonly>
        {#if leading}
            <span class="field-leading">{@render leading()}</span>
        {/if}
        <!--
          Native input variants need separate elements so Svelte's
          two-way binding doesn't fight the `type` attribute (changing
          type at runtime breaks bind:value).
        -->
        {#if type === "password"}
            <input
                type="password"
                bind:value
                {placeholder}
                {readonly}
                {autocomplete}
                {name}
                {id}
                class:mono
                {onfocus}
                {onblur}
                {oninput}
            />
        {:else if type === "email"}
            <input
                type="email"
                bind:value
                {placeholder}
                {readonly}
                {autocomplete}
                {name}
                {id}
                class:mono
                {onfocus}
                {onblur}
                {oninput}
            />
        {:else}
            <input
                type="text"
                bind:value
                {placeholder}
                {readonly}
                {autocomplete}
                {name}
                {id}
                class:mono
                {onfocus}
                {onblur}
                {oninput}
            />
        {/if}
    </div>
    {#if hint}<div class="field-hint mono">{hint}</div>{/if}
</label>

<style>
    .field {
        display: block;
        margin-bottom: 18px;
    }
    .field-row {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        margin-bottom: 8px;
    }
    .field-label {
        font-size: 11px;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: var(--ink-soft);
    }
    .field-optional {
        font-size: 11px;
        color: var(--ink-mute);
    }
    .field-input-row {
        display: flex;
        align-items: center;
        gap: 10px;
        border-bottom: var(--border-w) solid var(--ink);
        padding-bottom: 8px;
    }
    .field-input-row.readonly {
        border-bottom-style: dashed;
        border-bottom-color: var(--rule);
    }
    .field-leading {
        color: var(--ink-soft);
        display: inline-flex;
    }
    input {
        flex: 1;
        border: 0;
        outline: none;
        background: transparent;
        color: var(--ink);
        font-family: var(--font-sans);
        font-size: 15px;
        padding: 4px 0;
        min-width: 0;
    }
    input.mono {
        font-family: var(--font-mono);
    }
    input::placeholder {
        color: var(--ink-mute);
    }
    .field-hint {
        font-size: 12px;
        color: var(--ink-mute);
        margin-top: 6px;
    }
</style>
