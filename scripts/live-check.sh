#!/usr/bin/env bash
# The chat checks against the real agents installed on this computer: a Claude Code and a Codex
# chat each started, answered, approved and resumed across a daemon restart, through the daemon
# as the desktop app drives them, plus the agent command lists. Every other chat test runs a fake
# agent; run this after a Claude Code or Codex update, and before a release.
#
# Needs `claude` and `codex` on PATH and signed in. Each run spends a few small turns of each
# agent's plan, and leaves the test chats in their own history (in temp folders). Linux and macOS.
#
# LIVE_ONLY=claude|codex  run one agent's chat check only.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

filter="live_"
case "${LIVE_ONLY:-}" in
  "") ;;
  claude|codex) filter="live_${LIVE_ONLY}_" ;;
  *) echo "LIVE_ONLY must be claude or codex" >&2; exit 2 ;;
esac

for agent in claude codex; do
  if [ -z "${LIVE_ONLY:-}" ] || [ "$LIVE_ONLY" = "$agent" ]; then
    command -v "$agent" >/dev/null || { echo "$agent is not on PATH" >&2; exit 1; }
    echo "$agent: $("$agent" --version 2>/dev/null | head -n 1)"
  fi
done

# Plain `cargo test`, not scripts/test.sh: the real agents keep temp folders of their own
# (Claude Code's `claude-<uid>`), which that script's leak check would report as the tests'.
# One at a time: two real agents at once only make a failure harder to read.
cargo test -p maitty-core --lib "$filter" -- --ignored --test-threads=1 --nocapture
if [ -z "${LIVE_ONLY:-}" ]; then
  cargo test -p maitty-agent-ask -- --ignored
fi
