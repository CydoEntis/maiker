#!/usr/bin/env bash
# `cargo test` with a temp folder of its own, removed afterwards, and a check that the tests
# left nothing in it: a test that leaks a folder fails the run and is named by what it left.
# Arguments go to `cargo test` (for example `scripts/test.sh --locked`). Linux and macOS.
#
# TEST_TMP_ROOT  where the run's folder is made (default: the system temp folder). Keep it short
#                and outside any git checkout: tests draw temp paths and make folders that must
#                not be inside a repository.
set -euo pipefail

# Enough names to tell which tests leaked without flooding the log.
readonly SHOWN_LEFTOVERS=20

root="${TEST_TMP_ROOT:-${TMPDIR:-/tmp}}"
mkdir -p "$root"
tmp=$(mktemp -d "$root/test.XXXXXX")
runtime=""
cleanup() {
  rm -rf "$tmp"
  if [ -n "$runtime" ]; then rm -rf "$runtime"; fi
}
trap cleanup EXIT

if [ -z "${XDG_RUNTIME_DIR:-}" ]; then
  # Without it the daemons' sockets would go in the temp folder; they are not a test's to remove.
  runtime=$(mktemp -d "$root/runtime.XXXXXX")
  export XDG_RUNTIME_DIR="$runtime"
fi
export TMPDIR="$tmp"

status=0
cargo test "$@" || status=$?

leftovers=$(ls -A "$tmp")
if [ -n "$leftovers" ]; then
  count=$(wc -l <<<"$leftovers")
  echo "the tests left $count entries in their temp folder; the first $SHOWN_LEFTOVERS:" >&2
  head -n "$SHOWN_LEFTOVERS" <<<"$leftovers" >&2
  status=1
fi
exit "$status"
