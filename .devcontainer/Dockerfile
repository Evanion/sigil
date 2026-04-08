# .devcontainer/Dockerfile
# The base image provides the OS and a bootstrapping Rust toolchain.
# The actual Rust version used for builds is controlled by rust-toolchain.toml
# via rustup, so the base image tag only needs to provide a compatible OS.
# TODO(RF-005): Pin to a SHA256 digest once the team agrees on a base image version.
#   e.g. FROM mcr.microsoft.com/devcontainers/rust:1-bookworm@sha256:<digest>
FROM mcr.microsoft.com/devcontainers/rust:1-bookworm

# Install Node.js 22 LTS
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Install Rust components
RUN rustup component add clippy rustfmt rust-analyzer

# Install wasm target for future use
RUN rustup target add wasm32-unknown-unknown

# Install cargo-watch for development
RUN cargo install cargo-watch
