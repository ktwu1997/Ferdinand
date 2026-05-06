import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

export default defineConfig({
    plugins: [sveltekit()],
    server: {
        host: "0.0.0.0",
        port: 5174,
        strictPort: true,
        // OrbStack / reverse proxies assign per-container hostnames like
        // "<id>.orb.local". Allow any host for a local-dev prototype.
        allowedHosts: true,
        // Proxy backend routes to the running anki_server during dev so the
        // SvelteKit dev server (5174) and the prod-embedded server (40001)
        // can share the same client code without env switches.
        proxy: {
            "/api": "http://127.0.0.1:40001",
            "/media": "http://127.0.0.1:40001",
        },
    },
});
