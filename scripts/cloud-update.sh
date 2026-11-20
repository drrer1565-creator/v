#!/usr/bin/env bash
set -euo pipefail

# VideoKit Cloud Server Updater (scripts/cloud-update.sh)
# Usage:
#   bash scripts/cloud-update.sh [--branch <name>] [--stash] [--check] [--skip-build]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "$REPO_ROOT"

BRANCH=""
STASH=0
CHECK_ONLY=0
SKIP_BUILD=0

while [ "$#" -gt 0 ]; do
    case "$1" in
        --branch)
            BRANCH="${2:-}"
            shift 2
            ;;
        --branch=*)
            BRANCH="${1#--branch=}"
            shift
            ;;
        --stash)
            STASH=1
            shift
            ;;
        --check)
            CHECK_ONLY=1
            shift
            ;;
        --skip-build)
            SKIP_BUILD=1
            shift
            ;;
        -h|--help)
            cat <<'EOF'
Usage: bash scripts/cloud-update.sh [options]

Options:
  --branch <name>  Git branch to track/pull (default: current branch or main)
  --stash          Auto-stash uncommitted local changes before git pull
  --check          Fetch remote updates and print status without modifying files
  --skip-build     Skip 'npm run build' (videokit-web-server auto-serves newer src/)
  -h, --help       Show this help message
EOF
            exit 0
            ;;
        *)
            echo "[cloud-update] Unknown option: $1" >&2
            exit 2
            ;;
    esac
done

for cmd in git node npm; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
        echo "[cloud-update] Error: required command '$cmd' not found in PATH." >&2
        exit 3
    fi
done

if [ -z "$BRANCH" ]; then
    BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo main)"
    if [ "$BRANCH" = "HEAD" ] || [ -z "$BRANCH" ]; then
        BRANCH="main"
    fi
fi

BEFORE_VER="$(node -e "console.log(require('./package.json').version || 'unknown')" 2>/dev/null || echo unknown)"
BEFORE_COMMIT="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"

echo "[cloud-update] Repo: $REPO_ROOT"
echo "[cloud-update] Current: v$BEFORE_VER ($BEFORE_COMMIT) on branch '$BRANCH'"

git fetch --tags origin "$BRANCH"

REMOTE_COMMIT="$(git rev-parse --short "origin/$BRANCH" 2>/dev/null || echo unknown)"
LATEST_TAG="$(git tag --sort=-v:refname | head -n 1 || true)"

if [ "$CHECK_ONLY" -eq 1 ]; then
    echo "[cloud-update] Remote origin/$BRANCH: $REMOTE_COMMIT (latest tag: ${LATEST_TAG:-none})"
    if [ "$BEFORE_COMMIT" = "$REMOTE_COMMIT" ]; then
        echo "[cloud-update] Status: up-to-date"
    else
        echo "[cloud-update] Status: update available ($BEFORE_COMMIT -> $REMOTE_COMMIT)"
    fi
    exit 0
fi

STASHED=0
if [ -n "$(git status --porcelain)" ]; then
    if [ "$STASH" -eq 1 ]; then
        echo "[cloud-update] Stashing local modifications..."
        git stash push -u -m "cloud-update-$(date +%s)"
        STASHED=1
    else
        echo "[cloud-update] Error: working tree has uncommitted changes. Re-run with --stash." >&2
        exit 1
    fi
fi

echo "[cloud-update] Pulling origin/$BRANCH (ff-only)..."
git pull --ff-only origin "$BRANCH"

AFTER_COMMIT="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
AFTER_VER="$(node -e "console.log(require('./package.json').version || 'unknown')" 2>/dev/null || echo unknown)"

NEED_INSTALL=0
if [ ! -d "$REPO_ROOT/node_modules" ]; then
    NEED_INSTALL=1
elif [ "$BEFORE_COMMIT" != "$AFTER_COMMIT" ] && [ "$BEFORE_COMMIT" != "unknown" ]; then
    if git diff --name-only "$BEFORE_COMMIT" "$AFTER_COMMIT" | grep -qE '^package(-lock)?\.json$'; then
        NEED_INSTALL=1
    fi
fi

if [ "$NEED_INSTALL" -eq 1 ]; then
    echo "[cloud-update] Installing npm dependencies..."
    npm ci --omit=optional || npm install --omit=optional
fi

if [ "$SKIP_BUILD" -eq 0 ] && { [ "$BEFORE_COMMIT" != "$AFTER_COMMIT" ] || [ ! -f "$REPO_ROOT/dist/index.html" ]; }; then
    echo "[cloud-update] Rebuilding dist/..."
    npm run build
fi

if [ "$STASHED" -eq 1 ]; then
    echo "[cloud-update] Restoring stashed local changes..."
    if ! git stash pop; then
        echo "[cloud-update] Warning: 'git stash pop' had conflicts; resolve manually if needed." >&2
    fi
fi

for opt_cmd in ffmpeg ffprobe python3; do
    if ! command -v "$opt_cmd" >/dev/null 2>&1; then
        echo "[cloud-update] Warning: optional runtime '$opt_cmd' not found in PATH." >&2
    fi
done

echo "[cloud-update] Done: v$BEFORE_VER ($BEFORE_COMMIT) -> v$AFTER_VER ($AFTER_COMMIT)"
