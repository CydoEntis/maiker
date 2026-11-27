#!/usr/bin/env bash
# Terminal mode against the real Claude Code and Codex installed on this computer, through this
# checkout's own build, as the terminal app drives them. For each agent in a pane:
#   - its startup questions (folder trust, Codex's update and hooks review) show as needs you;
#   - starting up alone is not a finished turn;
#   - a reply comes back and the pane ends done;
#   - a file change waits as needs you (by its hook) and goes on once allowed;
#   - after the server restarts, the pane comes back in the same conversation and its finish
#     is not announced again.
#
# It runs a server of its own (AGENT_SOCKET=live-term-<pid>, alerts silenced), never your
# running one, and stops it at the end. Needs the agents on PATH, signed in, with Maiker's hooks
# installed (`maiker integrate`). Each run spends a few small turns of each plan. Linux and
# macOS. `LIVE_ONLY=claude` or `LIVE_ONLY=codex` runs one agent.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

readonly TURN_SECS=300
readonly START_SECS=90
readonly PONG="MAIKER-PONG"
readonly WRITTEN="maiker-live.txt"
readonly ECHOED="maiker-live-check"

cargo build -q -p maiker
# The CLI calls below are this build's. The agents' hooks run the program `integrate` wrote
# into their settings (the installed one), which reaches this server through the pane's
# environment.
export AGENT_SOCKET="live-term-$$"
scratch="$(mktemp -d)"
# The checks must not pop desktop alerts or play sounds: a config of its own with the sounds off,
# and the notification tools the server runs (found on its PATH) answered by stand-ins.
export AGENT_CONFIG="$scratch/config.toml"
printf '[notify]\nsound = false\n' >"$AGENT_CONFIG"
mkdir "$scratch/quiet"
for tool in notify-send osascript terminal-notifier; do
  printf '#!/bin/sh\nexit 0\n' >"$scratch/quiet/$tool"
  chmod +x "$scratch/quiet/$tool"
done
export PATH="$scratch/quiet:$root/target/debug:$PATH"
log_file="${XDG_DATA_HOME:-$HOME/.local/share}/maiker/daemon.log"
pane=0
agent=""

cleanup() {
  maiker kill-server --forget >/dev/null 2>&1 || true
  rm -rf "$scratch"
}
trap cleanup EXIT

fail() {
  echo "FAIL ($agent): $*" >&2
  echo "--- the pane's screen:" >&2
  maiker read "$pane" 2>/dev/null | grep -v '^\s*$' | tail -n 30 >&2 || true
  exit 1
}

# One field of the pane, from `ls --json`.
pane_field() {
  maiker ls --json | python3 -c '
import json, sys
pane, field = int(sys.argv[1]), sys.argv[2]
for ws in json.load(sys.stdin):
    for tab in ws["tabs"]:
        for p in tab["panes"]:
            if p["id"] == pane:
                print(p.get(field) or "")
' "$pane" "$1"
}

# Wait up to $2 seconds for the pane's status to be one of $1 (`done|idle`).
wait_status() {
  local want="$1" limit="$2" waited=0
  until [[ "|$want|" == *"|$(pane_field status)|"* ]]; do
    [ "$waited" -lt "$limit" ] || fail "status stayed $(pane_field status) ($(pane_field status_why)), wanted $want"
    sleep 1
    waited=$((waited + 1))
  done
}

start_server() {
  (maiker daemon >/dev/null 2>&1 &)
  local waited=0
  until maiker ls >/dev/null 2>&1; do
    [ "$waited" -lt 30 ] || { echo "the server did not start" >&2; exit 1; }
    sleep 1
    waited=$((waited + 1))
  done
}

screen() { maiker read "$pane" 2>/dev/null | grep -v '^\s*$' | tail -n 12 || true; }

# Answer the questions the agent asks before its prompt, checking each shows as needs you,
# until it rests at its prompt.
get_to_prompt() {
  local waited=0 shown
  while [ "$waited" -lt "$START_SECS" ]; do
    shown="$(screen)"
    local keys=()
    case "$agent:$shown" in
      # Its first choice is No, exit.
      claude:*"trust"*"Enter to confirm"*) keys=(--key down --key enter) ;;
      codex:*"Update available"*"esc skip"*) keys=(--key esc) ;;
      codex:*"Trust this folder?"*) keys=(--key enter) ;;
      # Trust all: Maiker's own status hooks.
      codex:*"Hooks need review"*) keys=(--key down --key enter) ;;
    esac
    if [ "${#keys[@]}" -gt 0 ]; then
      wait_status blocked 10
      echo "ok: a startup question shows as needs you ($(pane_field status_why))"
      sleep 1
      maiker send --pane "$pane" "${keys[@]}" >/dev/null
      sleep 3
      waited=$((waited + 4))
      continue
    fi
    if [[ "$shown" =~ $ready ]] && [ "$(pane_field status)" != working ]; then
      return 0
    fi
    sleep 1
    waited=$((waited + 1))
  done
  fail "never reached its prompt"
}

check_agent() {
  agent="$1"
  local start ready
  command -v "$agent" >/dev/null || { echo "$agent is not on PATH" >&2; exit 1; }
  echo "== $agent: $("$agent" --version 2>/dev/null | head -n 1)"
  case "$agent" in
    # Their default modes, whatever the person set, so a file change has to ask.
    claude) start="claude --permission-mode default"; ready='for shortcuts|Try "|mode on' ;;
    codex) start="codex -s read-only -a on-request"; ready='for shortcuts|Ask Codex' ;;
    *) echo "no live check for $agent" >&2; exit 1 ;;
  esac
  local folder="$scratch/$agent"
  mkdir -p "$folder"
  git -C "$folder" init -q
  # shellcheck disable=SC2086 # the start command is words
  maiker new "$folder" -- $start >/dev/null
  pane="$(maiker ls --json | python3 -c '
import json, sys
print(max(p["id"] for ws in json.load(sys.stdin) for tab in ws["tabs"] for p in tab["panes"]))')"
  get_to_prompt
  case "$(pane_field status)" in
    idle | "") echo "ok: started up, idle" ;;
    *) fail "started up as $(pane_field status) ($(pane_field status_why)) before it was asked anything" ;;
  esac

  # 1. A reply. `send --wait` waits for the turn this message starts; a bare `wait` would take
  # a pane that is already done as the answer.
  local reply
  reply="$(maiker send --pane "$pane" --wait --timeout "$TURN_SECS" "Reply with exactly $PONG and nothing else. Do not use any tools.")" \
    || fail "no turn end"
  [[ "$reply" == *"$PONG"* ]] || fail "the reply was not $PONG: $reply"
  wait_status done 15
  echo "ok: replied, done ($(pane_field status_why))"

  # 2. A file change waits for the person, and goes on once allowed.
  maiker send --pane "$pane" "Create a file named $WRITTEN in the current folder containing exactly the text $ECHOED, then reply DONE." >/dev/null
  wait_status blocked "$TURN_SECS"
  [[ "$(pane_field status_why)" == hook:* ]] || fail "the question was read off the screen, not reported by its hook: $(pane_field status_why)"
  echo "ok: the file change shows as needs you ($(pane_field status_why))"
  # The first choice is Yes.
  maiker send --pane "$pane" --key enter >/dev/null
  wait_status done "$TURN_SECS"
  [ "$(cat "$folder/$WRITTEN" 2>/dev/null)" = "$ECHOED" ] || fail "the file was not written"
  echo "ok: approved, written, done"

  # 3. The server restarts: the pane comes back with its conversation, and its finish is not
  # announced again. Every server on this computer writes the same log: read only what this one
  # wrote after its restart.
  local logged_before since_restart
  logged_before="$(wc -l <"$log_file")"
  maiker kill-server >/dev/null
  sleep 2
  start_server
  get_to_prompt
  since_restart="$(tail -n "+$((logged_before + 1))" "$log_file" | grep -E "listening on .*-$AGENT_SOCKET\.sock" -A 100000)"
  if grep -q "pane $pane: windows told Done" <<<"$since_restart"; then
    fail "the restart announced the old finish again"
  fi
  echo "ok: back after the restart, its finish not announced again"
  reply="$(maiker send --pane "$pane" --wait --timeout "$TURN_SECS" "What exact word did you reply with to my first message? Reply with that word only.")" \
    || fail "no turn end after the restart"
  [[ "$reply" == *"$PONG"* ]] || fail "the resumed conversation lost its context: $reply"
  echo "ok: resumed with its context"
}

start_server
for name in ${LIVE_ONLY:-claude codex}; do
  check_agent "$name"
done
echo "PASS"
