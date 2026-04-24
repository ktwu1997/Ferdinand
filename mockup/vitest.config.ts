import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { svelteTesting } from "@testing-library/svelte/vite";

// Stack choice (Phase 7-H): vitest 4.x + vite 6.x + plugin-svelte 6.x.
// vitest 4 uses the project's root vite (2.x bundled its own vite@5
// internally, which broke plugin-svelte 6.x's Environment API usage).
// Review notes for this bump: https://vitest.dev/guide/migration.html
// `svelte()` compiles .svelte modules; `svelteTesting()` adds the
// `browser` resolve condition, registers auto-cleanup via setupFiles,
// and marks @testing-library/svelte as ssr.noExternal. Both are
// required for component mount contracts to work under jsdom.
export default defineConfig({
    plugins: [svelte({ hot: false }), svelteTesting()],
    test: {
        environment: "jsdom",
        include: ["src/**/*.{test,spec}.ts"],
    },
    resolve: {
        alias: {
            $lib: new URL("./src/lib", import.meta.url).pathname,
            "$app/environment": new URL(
                "./src/test/stubs/app-environment.ts",
                import.meta.url,
            ).pathname,
            "$app/stores": new URL(
                "./src/test/stubs/app-stores.ts",
                import.meta.url,
            ).pathname,
        },
    },
});
