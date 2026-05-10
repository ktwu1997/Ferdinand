# syntax=docker/dockerfile:1.7
#
# Ferdinand container image (Phase 30-C).
#
# Multi-stage:
#   1. mockup-builder  : node:20-bookworm-slim, builds mockup/ -> mockup/build
#   2. rust-builder    : rust:1.92-bookworm, builds anki_server with embed-mockup
#   3. runtime         : debian:bookworm-slim, ships only the binary + curl
#
# Runtime expectations:
#   - port 40001
#   - /data volume holding collection.anki2
#   - ANKI_COLLECTION=/data/collection.anki2 (default)
#
# Build:
#     docker build -t ferdinand:local .
#
# Run (with persistent collection in ./data/collection.anki2):
#     docker run --rm -p 40001:40001 -v "$(pwd)/data:/data" ferdinand:local
#
# Or use docker-compose.yml for the friendlier path.

# ---------------------------------------------------------------------------
# Stage 1: mockup-builder — SvelteKit static build
# ---------------------------------------------------------------------------
FROM node:20-bookworm-slim AS mockup-builder

WORKDIR /build/mockup

# Copy manifests first so npm install caches when only sources change.
COPY mockup/package.json mockup/package-lock.json* mockup/yarn.lock* ./

# Install deps + force-install rollup's platform-specific native binary.
# Both `npm ci` AND `npm install` can silently skip rollup's optional
# native package (npm/cli#4828), so we install it explicitly for the
# build-target arch. Without this, `vite build` fails with
# `Cannot find module @rollup/rollup-linux-x64-gnu` at
# rollup/dist/native.js. The arch detection keeps it portable across
# linux/amd64 and linux/arm64 build hosts.
RUN npm install --no-audit --no-fund \
    && ARCH="$(uname -m)" \
    && case "$ARCH" in \
        x86_64)  NATIVE=@rollup/rollup-linux-x64-gnu ;; \
        aarch64) NATIVE=@rollup/rollup-linux-arm64-gnu ;; \
        *) echo "unsupported build arch: $ARCH" >&2 ; exit 1 ;; \
    esac \
    && npm install --no-audit --no-fund --no-save "$NATIVE"

# Now bring in the rest of the mockup source and build the static bundle.
COPY mockup/ ./

RUN npm run build

# ---------------------------------------------------------------------------
# Stage 2: rust-builder — anki_server with embedded mockup assets
# ---------------------------------------------------------------------------
# Match rust-toolchain.toml (channel = "1.92.0"). The workspace MSRV in
# Cargo.toml is "1.80" but the active toolchain is 1.92.
FROM rust:1.92-bookworm AS rust-builder

# protoc is needed by the workspace build scripts; ca-certificates for
# any cargo HTTPS work; pkg-config to satisfy native deps just in case.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        protobuf-compiler \
        ca-certificates \
        pkg-config \
    && rm -rf /var/lib/apt/lists/*

# Anki's rslib/proto/build.rs (set_protoc_path) only honours PROTOC /
# PROTOC_BINARY env vars — it does NOT search PATH. Without this,
# prost-build fails with "Could not find protoc" even though
# /usr/bin/protoc exists.
ENV PROTOC=/usr/bin/protoc

WORKDIR /build

# Copy the entire workspace. The Anki workspace has many crates and
# inter-crate path dependencies, so a partial copy + dummy-main warmup
# is fragile here. A single COPY keeps the Dockerfile honest and lets
# BuildKit layer-cache on file mtime.
COPY . .

# Drop in the prebuilt mockup output where include_dir!() expects it.
# Stage 1 wrote to /build/mockup/build; mirror that under our workspace.
COPY --from=mockup-builder /build/mockup/build ./mockup/build

# Build the release binary with the mockup embedded.
RUN cargo build \
        --profile release-lto \
        --bin anki_server \
        --features embed-mockup

# Locate the produced binary regardless of which release profile dir
# Cargo chose (release-lto vs release fallback) and stage it.
RUN set -eux; \
    if [ -x /build/target/release-lto/anki_server ]; then \
        cp /build/target/release-lto/anki_server /build/anki_server; \
    elif [ -x /build/target/release/anki_server ]; then \
        cp /build/target/release/anki_server /build/anki_server; \
    else \
        echo "anki_server binary not found in expected target dirs" >&2; \
        ls -la /build/target/ >&2; \
        exit 1; \
    fi; \
    strip /build/anki_server || true

# ---------------------------------------------------------------------------
# Stage 3: runtime — slim Debian with binary + curl for HEALTHCHECK
# ---------------------------------------------------------------------------
FROM debian:bookworm-slim AS runtime

# curl: HEALTHCHECK probe. ca-certificates: outbound TLS (sync, cdn).
# tini-style PID 1 is overkill for a single Rust binary.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        curl \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Run as a non-root user. /data is owned by this user so the bind mount
# can be written to.
RUN groupadd --system --gid 1000 ferdinand \
    && useradd  --system --uid 1000 --gid ferdinand --home /app --shell /usr/sbin/nologin ferdinand \
    && mkdir -p /data \
    && chown -R ferdinand:ferdinand /data

WORKDIR /app

COPY --from=rust-builder /build/anki_server /usr/local/bin/anki_server

ENV ANKI_COLLECTION=/data/collection.anki2 \
    ANKI_SERVER_PORT=40001 \
    RUST_LOG=info,anki_server=debug

EXPOSE 40001
VOLUME ["/data"]

USER ferdinand

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD curl -fsS http://127.0.0.1:40001/api/health || exit 1

CMD ["/usr/local/bin/anki_server"]
