#!/usr/bin/env node
// Phase B3a `.apkg` import endpoint e2e (pure API, no DOM).
//
// Mirrors a11_admin.mjs in shape — exercises the live anki_server
// (BASE = http://127.0.0.1:40001 by default) so it catches integration
// regressions across the multipart streaming path, the
// require_auth gate, the spawn_blocking + tokio Mutex hand-off into
// rslib's import_apkg, and the AnkiError → 400 mapping for corrupt
// archives.
//
// Required env:
//   FERDINAND_TEST_PASSWORD  — the configured ktwu password
//
// Notes:
//   • Self-service endpoint — no admin gate. We log in as the regular
//     ktwu account; the suite does NOT exercise the friend account
//     (admin endpoints are covered by a11). That keeps a12's per-IP
//     login budget impact down to ONE login.
//   • Login-budget cooldown: anki_server's /api/auth/login limiter is
//     keyed by (ip, username) AND has a per-IP umbrella shared across
//     users (BUDGET=5/60s — see auth/rate_limit.rs). When this suite
//     runs back-to-back with the visual e2e suites or a11_admin, the
//     ktwu/127.0.0.1 slot may already be saturated. Set
//     FERDINAND_FRIEND_COOLDOWN=65 to insert a 65-second sleep at
//     the top of the suite (mirrors a11's flag — the env var name is
//     reused for harness consistency, even though a12 has no friend).
//
// Cases:
//   1. anon POST /api/import/apkg                                       → 401
//   2. authed POST with upstream pylib/tests/support/update1.apkg       → 200
//      + imported_note_count >= 0 + log_summary present
//   3. authed POST with garbage bytes ("this is not a zip file")        → 400
//   4. authed POST with empty multipart (no `file` field at all)        → 400
//
// Fixture: mockup/tests/fixtures/sample.apkg, generated on demand via
// `cargo run -p anki_server --example build_test_apkg --
// mockup/tests/fixtures/sample.apkg`. The upstream pylib/tests/support
// fixtures are 2012-era schema and modern rslib import rejects them
// with InvalidInput, so we synthesise a fresh one. The example builds
// it from a temp Collection (1 deck "B3a sample", 1 note via Basic
// notetype). Reproducible — re-run the example to regenerate.
//
// If the fixture is missing the suite records case 2 as failing
// (rather than skipping silently) so a sparse checkout doesn't
// masquerade as a green test.
//
// Usage:
//   FERDINAND_TEST_PASSWORD=... node mockup/tests/e2e/a12_apkg_import_api.mjs
//
// Exit 0 = all green; non-zero = at least one assertion failed.

import { request } from "playwright";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ART = path.join(__dirname, "artifacts", "a12_apkg_import");
fs.mkdirSync(ART, { recursive: true });

const BASE = process.env.E2E_BASE || "http://127.0.0.1:40001";
const TEST_USER = process.env.FERDINAND_TEST_USER || "ktwu";
const TEST_PASSWORD = process.env.FERDINAND_TEST_PASSWORD || "";
const COOLDOWN_SECS = Number(process.env.FERDINAND_FRIEND_COOLDOWN || "0");

// Synthetic modern-schema fixture; build with the example binary if absent.
const APKG_FIXTURE = path.resolve(
    __dirname,
    "..",
    "fixtures",
    "sample.apkg",
);

if (!TEST_PASSWORD) {
    console.error(
        "FERDINAND_TEST_PASSWORD must be set so ktwu can authenticate.",
    );
    process.exit(2);
}

const result = { base: BASE, started: new Date().toISOString(), checks: [] };
const record = (name, passed, detail) => {
    result.checks.push({ name, passed, detail });
    console.log(`${passed ? "✓" : "✗"} ${name}${detail ? "  — " + detail : ""}`);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function adminLogin(ctx) {
    const res = await ctx.post("/api/auth/login", {
        data: { username: TEST_USER, password: TEST_PASSWORD },
    });
    if (res.status() !== 200) {
        throw new Error(`ktwu login failed: ${res.status()}`);
    }
}

const anon = await request.newContext({ baseURL: BASE });
const authed = await request.newContext({ baseURL: BASE });

try {
    if (COOLDOWN_SECS > 0) {
        console.log(`// FRIEND_COOLDOWN=${COOLDOWN_SECS}s — waiting…`);
        await sleep(COOLDOWN_SECS * 1000);
    }

    await adminLogin(authed);

    // 1. anon POST → 401. We send a tiny multipart so the request body
    //    is shaped correctly; the auth gate fires before parsing kicks in.
    {
        const res = await anon.post("/api/import/apkg", {
            multipart: {
                file: {
                    name: "noop.apkg",
                    mimeType: "application/octet-stream",
                    buffer: Buffer.from("noop"),
                },
            },
        });
        record(
            "1. POST /api/import/apkg anon → 401",
            res.status() === 401,
            `status=${res.status()}`,
        );
    }

    // 2. authed POST with a valid .apkg → 200. We don't assert an exact
    //    note count (the upstream fixture's contents are not under our
    //    control across rebases), but we DO assert log_summary is present
    //    and imported_note_count is a number. That's strong enough to
    //    catch a serialisation regression while staying fixture-agnostic.
    {
        const fixtureExists = fs.existsSync(APKG_FIXTURE);
        if (!fixtureExists) {
            record(
                "2. POST /api/import/apkg authed + valid apkg → 200",
                false,
                `fixture missing at ${APKG_FIXTURE}`,
            );
        } else {
            const buf = fs.readFileSync(APKG_FIXTURE);
            const res = await authed.post("/api/import/apkg", {
                multipart: {
                    file: {
                        name: "sample.apkg",
                        mimeType: "application/octet-stream",
                        buffer: buf,
                    },
                },
            });
            const status = res.status();
            let body = null;
            let parseErr = null;
            try {
                body = await res.json();
            } catch (e) {
                parseErr = String(e);
            }
            const ok =
                status === 200 &&
                body &&
                typeof body.imported_note_count === "number" &&
                typeof body.updated_note_count === "number" &&
                typeof body.skipped_count === "number" &&
                typeof body.log_summary === "string" &&
                body.log_summary.length > 0;
            record(
                "2. POST /api/import/apkg authed + valid apkg → 200",
                ok,
                `status=${status} body=${
                    body ? JSON.stringify(body) : `parse-error:${parseErr}`
                }`,
            );
        }
    }

    // 3. authed POST with garbage bytes (not a zip) → 400. rslib's
    //    ZipArchive::new fails inside import_apkg; our map_import_error
    //    folds AnkiError::ImportError to a 400.
    {
        const res = await authed.post("/api/import/apkg", {
            multipart: {
                file: {
                    name: "garbage.apkg",
                    mimeType: "application/octet-stream",
                    buffer: Buffer.from(
                        "this is not a zip file ".repeat(4),
                        "utf-8",
                    ),
                },
            },
        });
        record(
            "3. POST /api/import/apkg authed + garbage bytes → 400",
            res.status() === 400,
            `status=${res.status()}`,
        );
    }

    // 4. authed POST with empty multipart (no `file` field, just an
    //    unrelated `note` field) → 400. The handler's "no file field
    //    found" branch fires here.
    {
        const res = await authed.post("/api/import/apkg", {
            multipart: {
                note: "i forgot the actual file",
            },
        });
        record(
            "4. POST /api/import/apkg authed + no file field → 400",
            res.status() === 400,
            `status=${res.status()}`,
        );
    }
} finally {
    fs.writeFileSync(
        path.join(ART, "result.json"),
        JSON.stringify(
            { ...result, ended: new Date().toISOString() },
            null,
            2,
        ),
    );
    await anon.dispose();
    await authed.dispose();
}

const failed = result.checks.filter((c) => !c.passed);
if (failed.length === 0) {
    console.log(`\nAll ${result.checks.length} checks passed.`);
    process.exit(0);
} else {
    console.error(`\n${failed.length} of ${result.checks.length} checks failed.`);
    process.exit(1);
}
