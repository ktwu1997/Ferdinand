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
    },
});
