# Release Guide

## Overview

Sigil uses a trunk-based development model with release branches for channel promotion.

### Branches

| Branch | Purpose |
|---|---|
| `main` | Active development. All PRs merge here. Auto-publishes `dev` Docker images. |
| `release/<version>` | Created when preparing a release. Goes through beta → rc → stable. |

### Release Channels

| Channel | Docker Tags | Who Can Pull | Purpose |
|---|---|---|---|
| `dev` | `dev`, `dev-<sha>` | Developers | Latest from main, may be unstable |
| `beta` | `beta`, `<version>-beta.N` | Early adopters | Feature-complete, undergoing testing |
| `rc` | `rc`, `<version>-rc.N` | Broader testing | Final validation before stable |
| `stable` | `latest`, `<version>`, `<major>.<minor>` | Everyone | Production-ready |

### Docker Images

All images are published to `ghcr.io/evanion/sigil` and built for both `linux/amd64` and `linux/arm64` (Apple Silicon).

```bash
# Dev (latest from main)
docker pull ghcr.io/evanion/sigil:dev

# Beta
docker pull ghcr.io/evanion/sigil:beta
docker pull ghcr.io/evanion/sigil:1.0.0-beta.1

# Release candidate
docker pull ghcr.io/evanion/sigil:rc
docker pull ghcr.io/evanion/sigil:1.0.0-rc.1

# Stable (production)
docker pull ghcr.io/evanion/sigil:latest
docker pull ghcr.io/evanion/sigil:1.0.0
docker pull ghcr.io/evanion/sigil:1.0
```

---

## Automated: Changelog & Version Bumps

We use [release-please](https://github.com/googleapis/release-please) to automate version bumps and changelog generation from conventional commits.

### How It Works

1. Every push to `main` triggers release-please
2. It analyzes conventional commits since the last release:
   - `feat:` → minor version bump
   - `fix:` → patch version bump
   - `feat!:` or `BREAKING CHANGE:` → major version bump (post-1.0)
   - `chore:`, `docs:`, `ci:` → no version bump
3. It creates/updates a **Release PR** that:
   - Bumps version in `Cargo.toml` and `frontend/package.json`
   - Updates `CHANGELOG.md` with grouped commit messages
4. When you merge the Release PR, it creates a GitHub Release with a git tag

### Commit Messages Matter

Use conventional commits consistently. The changelog is generated directly from these:

```
feat(core): add node tree operations          → ## Features: - add node tree operations
fix(server): handle websocket reconnection    → ## Bug Fixes: - handle websocket reconnection
feat!: redesign file format for v2            → ## ⚠ BREAKING CHANGES: - redesign file format
```

---

## Manual: Channel Promotion

After release-please creates a version tag, promote it through channels using the manual Release workflow.

### Step 1: Create a Release Branch (optional)

For significant releases, create a release branch to stabilize:

```bash
git checkout main
git pull
git checkout -b release/1.0.0
git push -u origin release/1.0.0
```

For small releases, you can promote directly from main or a tag.

### Step 2: Trigger Beta

1. Go to **Actions** → **Release** → **Run workflow**
2. Fill in:
   - **Channel:** `beta`
   - **Version:** `1.0.0`
   - **Source ref:** `release/1.0.0` (or a tag/SHA)
3. Click **Run workflow**

This publishes:
- `ghcr.io/evanion/sigil:1.0.0-beta.1`
- `ghcr.io/evanion/sigil:beta`

### Step 3: Test Beta

- Deploy the beta image in a test environment
- Run through the test plan for the release
- Fix issues on the release branch (cherry-pick from main if needed)
- Re-run beta workflow if fixes were applied (it will publish `beta.2`, etc.)

### Step 4: Trigger Release Candidate

Same process as beta, but select `rc`:

1. **Actions** → **Release** → **Run workflow**
2. **Channel:** `rc`, **Version:** `1.0.0`, **Source ref:** `release/1.0.0`

This publishes:
- `ghcr.io/evanion/sigil:1.0.0-rc.1`
- `ghcr.io/evanion/sigil:rc`

### Step 5: Final Validation

- RC should be treated as "this is the release unless we find a blocker"
- No new features — only critical bug fixes
- If fixes are needed, cherry-pick and publish `rc.2`

### Step 6: Trigger Stable

1. **Actions** → **Release** → **Run workflow**
2. **Channel:** `stable`, **Version:** `1.0.0`, **Source ref:** `release/1.0.0`

This publishes:
- `ghcr.io/evanion/sigil:1.0.0`
- `ghcr.io/evanion/sigil:1.0`
- `ghcr.io/evanion/sigil:latest`

### Step 7: Post-Release

1. Merge the release branch back to main (if any cherry-picked fixes aren't there already)
2. Delete the release branch
3. Announce the release

---

## Quick Reference

### "I want to release what's on main right now"

```
1. Merge the release-please PR (creates tag + GitHub Release + changelog)
2. Actions → Release → stable, version from the tag, source_ref = the tag
```

### "I want to do a beta test first"

```
1. Create release/X.Y.Z branch from main
2. Actions → Release → beta, version X.Y.Z, source_ref = release/X.Y.Z
3. Test, fix, repeat
4. Actions → Release → rc
5. Test, fix, repeat
6. Actions → Release → stable
```

### "I need to hotfix a stable release"

```
1. Create hotfix/X.Y.Z+1 branch from the stable tag
2. Fix the issue, commit with conventional message
3. Actions → Release → stable, version X.Y.Z+1, source_ref = hotfix branch
4. Cherry-pick fix back to main
```

---

## Troubleshooting

### release-please isn't creating a Release PR

- Check that commits use conventional format (`feat:`, `fix:`, etc.)
- `chore:` and `docs:` commits don't trigger version bumps
- Check the release-please action logs in Actions tab

### Beta number isn't incrementing

The current release workflow uses a static `.1` suffix. For proper incrementing, check existing tags:

```bash
git tag -l "v1.0.0-beta.*" | sort -V | tail -1
```

And specify the next number manually in the version input, or we can enhance the workflow to auto-increment later.

### Multi-arch build is slow

First builds take longer (~10-15 min) due to QEMU emulation for arm64. Subsequent builds use the GitHub Actions cache and should be faster (~3-5 min).
