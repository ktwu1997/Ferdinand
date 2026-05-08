/**
 * Phase A4-α — sketch UI primitives barrel. Mirrors
 * design_handoff_ferdinand/source/primitives.jsx but in Svelte 5 runes.
 *
 * Pages should `import { Btn, Field, Caption, Chip, Panel, Divider }
 * from "$lib/components/ui"` and then wrap their root markup in
 * `<div class="sketch-skin">…</div>` so the CSS variables resolve to
 * the kraft-paper palette defined in styles/tokens.css.
 */
export { default as Btn } from "./Btn.svelte";
export { default as Field } from "./Field.svelte";
export { default as Caption } from "./Caption.svelte";
export { default as Chip } from "./Chip.svelte";
export { default as Panel } from "./Panel.svelte";
export { default as Divider } from "./Divider.svelte";
