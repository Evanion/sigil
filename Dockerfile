# Stage 1: Build frontend
FROM node:22-bookworm-slim AS frontend-builder
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app/frontend
COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY frontend/ .
RUN pnpm build

# Stage 2: Prepare Rust dependency recipe
FROM rust:1.94.1-bookworm AS chef
RUN cargo install cargo-chef
WORKDIR /app

# Stage 2a: Analyze dependencies
FROM chef AS planner
COPY Cargo.toml Cargo.lock ./
COPY crates/ crates/
COPY cli/ cli/
RUN cargo chef prepare --recipe-path recipe.json

# Stage 2b: Build dependencies (cached unless Cargo.toml/Cargo.lock change)
FROM chef AS rust-deps
COPY --from=planner /app/recipe.json recipe.json
RUN cargo chef cook --release --recipe-path recipe.json

# Stage 2c: Build application (only recompiles project code on source changes)
FROM rust-deps AS rust-builder
COPY Cargo.toml Cargo.lock ./
COPY crates/ crates/
COPY cli/ cli/
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
