// Stub for SvelteKit's virtual `$app/environment` module so vitest
// can resolve it outside of a running SvelteKit dev server. Keep the
// exports in sync with SvelteKit's upstream module surface — a missing
// named export is a runtime `undefined` at the call site, not a
// compile error, so silent drift is possible.
// Reference: https://svelte.dev/docs/kit/$app-environment
export const browser = true;
export const dev = true;
export const building = false;
export const version = "test";
