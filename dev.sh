#!/usr/bin/env bash
set -euo pipefail

# dev.sh — Run commands inside the dev container from the host.
# If already inside the container, runs commands directly.
# Usage: ./dev.sh cargo test --workspace
#        ./dev.sh pnpm --prefix frontend build

CONTAINER_NAME="sigil-dev"

# Detect if we're inside the dev container
if [ -f /.dockerenv ] || grep -q "docker\|containerd" /proc/1/cgroup 2>/dev/null; then
    # Inside container — run directly
    exec "$@"
fi

# Outside container — check if dev container is running
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
    echo "Error: Dev container '${CONTAINER_NAME}' is not running." >&2
    echo "Start it with: devcontainer up --workspace-folder ." >&2
    echo "Or:            docker compose -f .devcontainer/docker-compose.yml up -d" >&2
    exit 1
fi

# Get the workspace path inside the container
WORKSPACE_DIR="/workspaces/sigil"

# Execute command inside the running container
exec docker exec -w "${WORKSPACE_DIR}" -it "${CONTAINER_NAME}" "$@"
