# 0021. Agents run over ACP are installed from the ACP registry

- **Status:** Accepted
- **Date:** 2026-11-21

## Context

An agent with no adapter of its own runs as a chat over ACP (0019, 0020). Until now that needed
two manual steps: install the agent's ACP program, and write an `[[agents]]` entry naming it,
its arguments and its variables. Someone who installs Maiker and picks an agent in the Chat view
should not have to do either.

The ACP project publishes a registry: one JSON file listing agents, and for each a download per
kind of computer (with a SHA-256), an npm package at an exact version, or a Python package.
Other ACP clients install from it.

Installing from it means running code a third party published, chosen by a file fetched at run
time. The desktop app's installer for Claude Code, Codex, Gemini and OpenCode
([SECURITY](../SECURITY.md#project-specific-installing-an-agent-from-the-desktop)) allows only
commands written in the source; a registry cannot be held to that.

## Decision

- Maiker installs an agent run over ACP from the registry, on request, into its own data folder
  (`acp-agents/<id>/<version>/`). It never installs one by itself.
- The registry's address is fixed in code. Its content is untrusted input: an entry is used only
  when every part passes the checks in `maitty-core/src/acp_registry.rs`, and one that does not
  is left out of the list.
- A download is taken only over https and only when the registry gives its SHA-256, which is
  checked before anything is unpacked. An entry with no checksum is not installed.
- An npm package is installed only at the exact version the registry names, with this
  computer's npm, into the agent's own folder. A Python package is not installed yet.
- What is installed is recorded in `acp-agents/installed.json`. The daemon runs an agent by
  name from its config first and from that file second; a client still never names a program.
- The work is done by the command line (`maiker agents install <id>`), which the desktop app
  runs. The daemon downloads nothing.
- The registry's helpers for Claude Code and Codex are not listed: those agents run through
  their own adapters (0020).

## Alternatives considered

- **Keep manual `[[agents]]` entries only**: nothing new to trust. It lost because a person
  cannot be expected to find an agent's ACP flag and write config to try an agent.
- **A fixed list of agents in the source**, as the terminal agents' installer has: every
  command reviewed. It lost because each new agent or version would need a release.
- **Take entries without a checksum, trusting https**, as other clients do: more agents
  install. It lost because the checksum is the only thing tying the download to the registry.
- **Download with an HTTP library in the daemon**: no dependence on the system's curl and tar.
  It lost because it adds a network client to the process that owns every session.

## Consequences

- An agent from the registry runs as the person, with their files and network. The registry
  and the agent's publisher are trusted for that; the checksum only proves the download is the
  one the registry described.
- Agents that publish no checksum, or only a Python package, cannot be installed from here.
- npm agents need Node.js on the computer; Maiker does not install it.
- A newer version in the registry is installed only when the person asks again.
- `docs/SECURITY.md` gains a section for this installer; `docs/stack/acp.md` and
  `docs/ENVIRONMENT.md` describe the files and the command.
