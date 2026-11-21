# 0017. Remote machines rely on your own ssh setup and trust a new host key once

- **Status:** Accepted
- **Date:** 2026-11-21

## Context

[0007](0007-multiple-machines.md) reaches every other machine over one hardened ssh line, held by the
client. Around that line Maiker grew its own ssh teaching: a five-step checklist when a machine is added,
a host-key screen that shows a fingerprint and asks before anything is trusted, a key screen that installs
a public key with the account password once (`crates/maitty-machines/src/key_login.rs`), and a settings
page per machine. Each screen had to be kept safe on its own (see `docs/SECURITY.md`, remote machine
logins from the desktop), and together they made adding a machine slower than typing `ssh <name>`.

The people Maiker serves already use ssh: they have `~/.ssh/config`, keys and an agent, and a machine
they want to add usually answers `ssh <name>` already. The user compared Maiker with T3 Code, whose Add
environment is one host or alias field and one button: it relies on the person's ssh config and agent,
and it cannot answer a second prompt such as Duo. Against that, Maiker's checklist, host-key screen, key
screen and per-machine pages were judged far too complex.

## Decision

This amends [0007](0007-multiple-machines.md) where it decides how a machine is reached and added; the
rest of 0007 stands (one connection per machine, held by the client; the remote daemon is untrusted; all
reach through `crates/maitty-machines`).

- **Your ssh setup is the setup.** Maiker uses the person's own `~/.ssh/config`, keys and ssh-agent. If
  `ssh <name>` works in a terminal, adding that name works in Maiker. Maiker no longer teaches ssh setup
  and installs no keys: the password-once key install (`key_login`) is removed.
- **A new host key is trusted on first connection, without a question,** the way OpenSSH's
  `StrictHostKeyChecking=accept-new` does: ssh itself records the key in `known_hosts`, Maiker shows no
  fingerprint and writes no key. A host key that differs from the one on record is still refused, with a
  clear message. Host-key checking is never turned off.
- **Adding a machine shows no steps:** one field, one button, a spinner, then either the machine appears
  or one plain sentence says what failed and gives the exact fix. The desktop app and the terminal app
  take those sentences from one shared set in `crates/maitty-machines`, so the two never disagree.
- **One fallback for a login ssh cannot finish alone.** A login that needs a password or a second code
  (Duo, an OTP) keeps the existing "sign in in a terminal" button; nothing else asks for credentials.
- **Settings shows remote machines as one short list**, with no page per machine. Clipboard and
  notice grants keep 0007's defaults: clipboard on, notices off.

## Alternatives considered

- **Keep the guided checklist, host-key screen and key screen:** rejected; they repeat what a developer's
  ssh setup already does, and each one was a separate surface to keep safe.
- **A "remote link" pairing code without ssh, as T3 Code also offers:** not chosen now; it is a new way to
  connect outside 0007's one-ssh-connection model, with its own transport and trust to design.
- **`StrictHostKeyChecking=no`:** rejected; it would also accept a changed key, which is the case
  host-key checking exists to catch.

## Consequences

- Adding a machine that `ssh <name>` already reaches is one field and one click; Maiker keeps no ssh
  setup screens and no code that handles an account password.
- Risk accepted: the first connection to a new host trusts whatever key answers, as plain ssh with
  `accept-new` does. A key that changes later is still refused.
- A beginner without a working key gets a command to run instead of a guided setup.
- A login that needs a person (password, second code) works only through the terminal sign-in.
- Revisit if Maiker must serve people who do not already use ssh, or if a pairing link without ssh is
  wanted; that would be a new ADR beside 0007.
