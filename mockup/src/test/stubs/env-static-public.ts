// Stub for SvelteKit's virtual `$env/static/public` module so vitest
// can resolve it outside of a running SvelteKit dev server. Each named
// export mirrors a PUBLIC_* env var read at build time. Tests that need
// a specific value should use `vi.stubEnv` on `import.meta.env` or
// reassign the module via vi.mock — but for the SSRF guard tests we
// control the window.location stub directly and leave this empty so the
// default (no allowed bases) applies.
export const PUBLIC_API_ALLOWED_BASES = "";
