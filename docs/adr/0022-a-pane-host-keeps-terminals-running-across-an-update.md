# 0022. A pane host keeps terminals running across a daemon update

- **Status:** Proposed (amends 0001)
- **Date:** 2026-11-27

## Context

Every update restarts the daemon, about once a day, and the daemon owns every PTY (0001), so
each restart ends every pane. Agents are started again and resume their conversation (`restore`),
but a turn in progress is lost, a plain shell's running program is gone, and the person has to
wait for every agent to be idle before updating (`maiker update` defaults to "no" while any
agent is busy). The daemon is large and changes in almost every release; the part that has to
survive is small: a pseudo-terminal, the program in it, and its recent output.

## Decision

- A **pane host** (`maiker pane-host`, one per socket) holds every PTY and its child process.
  The daemon starts it on first use and it outlives the daemon. It does no terminal emulation,
  status, hooks or persistence. It keeps per pane the PTY, the child, and the raw output ring the
  daemon keeps today (`Term::ring_cap`).
- The daemon talks to the host over its own local socket (`<APP>_SOCKET`-named, private
  directory, same peer checks as the daemon's socket). The messages are spawn, write, resize,
  kill, list, and a stream of output and exits.
- **Bytes are relayed, not handles.** The host does the PTY I/O and forwards output; it never
  passes a file descriptor or ConPTY handle to the daemon. A ConPTY's `HPCON` can't be resized or
  closed from another process, so handle passing would work on Unix only and break
  non-negotiable 3. One extra local hop per output chunk costs far less than the 12 ms the
  desktop app already gathers output for before it draws (PERFORMANCE.md, item 6); the cost is
  to be measured before it ships.
- A new daemon attaches with `list`. It rebuilds each pane's vt100 screen by replaying the
  ring into a fresh parser, then follows the live stream. Its pane ids, status and hooks state
  come from its own saved session, as a restart's do today. A pane the host no longer has, or
  one it never had, comes back the way a restart restores it now.
- **The host's protocol is frozen and tiny, and versioned apart from `PROTOCOL_VERSION`.** An
  update replaces the binary while the old host keeps running, so a new daemon must speak to
  hosts back to the host protocol's first version. A host is replaced only when it holds no
  pane: the daemon starts a new one for new panes and lets the old one end with its last pane.
- The daemon still owns sessions as 0001 says: the host takes orders only from the daemon,
  never from a client, and a client still only draws and sends input.

## Alternatives considered

- **Pass PTY handles to the new daemon** (`SCM_RIGHTS` on Unix): no extra hop, but there is no
  Windows equivalent for a ConPTY, and the vt100 state would still be lost.
- **Exec the new daemon in place, keeping file descriptors**: Unix only, and every daemon
  structure would have to be serialised across the exec.
- **Wait for idle agents before every update** (today's default): keeps turns, but plain shells
  and long-running commands still end, and updates are put off indefinitely while agents work.

## Consequences

- Updating no longer ends a pane: agents mid-turn keep working, and a shell's running command
  survives.
- One more process per socket, which `kill-server` and `doctor` must name. `kill-server --forget`
  ends the host too, so the old "stop everything" stays available.
- The host protocol becomes a second contract that can't change incompatibly. Changes to it
  are additive only, with a version of its own.
- Estimate: about two to three weeks.
  - Host binary and protocol, with tests over a real PTY on Linux, macOS and Windows: one week.
  - Moving `Term`'s spawn, write, resize and kill behind a host client, with ring replay on
    attach: one week.
  - Host lifetime: start, replace when empty, `kill-server`, `doctor`, crash recovery back to
    today's restore: three to five days.
  - The live check across a real update.
