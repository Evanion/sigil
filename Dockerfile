# Stage 1: Build frontend
FROM node:22-bookworm-slim AS frontend-builder
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app/frontend
COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY frontend/ .
RUN pnpm build

# Stage 2: Build Rust
FROM rust:1.94.1-bookworm AS rust-builder
WORKDIR /app
COPY Cargo.toml Cargo.lock rust-toolchain.toml ./
COPY crates/ crates/
COPY cli/ cli/
# Build dependencies first for caching
RUN cargo build --release --bin agent-designer-server

# Stage 3: Runtime
FROM debian:bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd -g 1001 sigil && useradd -r -u 1001 -g sigil sigil

COPY --from=rust-builder /app/target/release/agent-designer-server /usr/local/bin/
COPY --from=frontend-builder /app/frontend/dist /usr/local/share/sigil/frontend

USER sigil
ENV PORT=4680
EXPOSE 4680

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
    CMD curl -f http://localhost:4680/health || exit 1

ENTRYPOINT ["agent-designer-server"]
