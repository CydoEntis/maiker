#!/usr/bin/env bash
# Builds and runs the CURRENT worktree's desktop app on Linux or macOS with its OWN service, data, config
# and install folder, so a debug build never takes over the service your installed app and its agents use.
# The counterpart of `scripts/dev.ps1 gui` on Windows. Anything you set yourself is kept.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# The prefix comes from apps/gui/src/brand.ts, the one file that holds the brand names (ADR 0012).
prefix="$(sed -n "s/^export const ENV_PREFIX = '\([^']*\)'.*/\1/p" "$root/apps/gui/src/brand.ts")"
[ -n "$prefix" ] || { echo "apps/gui/src/brand.ts has no ENV_PREFIX" >&2; exit 1; }
folder="$(basename "$root")"
isolated="${XDG_STATE_HOME:-$HOME/.local/state}/maiker-dev/$folder"

set_default() { # name value: keep what the caller already set
  local name="${prefix}_$1"
  [ -n "${!name:-}" ] || export "$name=$2"
}
set_default SOCKET "dev-$folder"
set_default DATA_DIR "$isolated/data"
set_default CONFIG "$isolated/config.toml"
set_default INSTALL_DIR "$isolated/bin"
mkdir -p "$(printenv "${prefix}_DATA_DIR")" "$(printenv "${prefix}_INSTALL_DIR")"

echo "worktree: $root  commit: $(git -C "$root" rev-parse --short HEAD)$([ -n "$(git -C "$root" status --porcelain)" ] && echo '*')"
echo "own service: $(printenv "${prefix}_SOCKET")  data: $(printenv "${prefix}_DATA_DIR")"

cd "$root/apps/gui"
[ -d node_modules ] || pnpm install --frozen-lockfile
node scripts/bundle-daemon.ts
# NVIDIA under Wayland can die with a protocol error; this is the documented workaround (docs/ENVIRONMENT.md).
export WEBKIT_DISABLE_DMABUF_RENDERER="${WEBKIT_DISABLE_DMABUF_RENDERER:-1}"
exec pnpm desktop:dev
