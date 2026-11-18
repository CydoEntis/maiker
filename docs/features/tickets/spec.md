# Spec: tickets in the app

> **Removed 2026-11-17** (the user's call; [ADR 0013](../../adr/0013-no-in-app-tickets.md)). Kept as history of what was built; none of it is in the app any more.

Type: feature · Status: in progress. The model, the read-only GitHub provider (MAITTY-392) and the read-only Plane (MAITTY-395) and Linear (MAITTY-396) providers are built, with the shared `curl` sender and the daemon's key store: `maitty_shared::tickets`, `daemon/tickets_github.rs`, `tickets_plane.rs`, `tickets_linear.rs`, `ticket_keys.rs`, `Query::Tickets` (protocol 105) and `Query::TicketKeys` (protocol 106) and `Query::TicketLinks` (protocol 108, `daemon/ticket_links.rs`: which sources each project reads, kept by the daemon per repository so every client and worktree shows a project the same tickets); the desktop Tickets view and Settings › Tickets are built (UI › *Tickets view*); Plane and Linear are not yet checked against a live server · Decision from MAITTY-391 · Date: 2026-11-14

Read your tickets from GitHub, Plane and Linear inside Maiker: browse by project or module,
search, pick one, read it whole and start an agent on it. Read-only: the confirmed writes (MAITTY-398) and
handing tickets to Kitchen (MAITTY-397) were removed by [ADR 0011](../../adr/0011-maitty-reads-tickets-and-shows-no-workflow-runs.md). Tickets: Plane module "Tickets in the app" (MAITTY-391 to 398, plus the grouping
ticket filed with this spec).

## Decision: what was reused

`maitty-core/src/curl_http.rs` (the system `curl`, token on stdin, no redirects, 20 s, 4 MiB cap)
and the Plane REST details came from the dropped project-crews work; its tracker, crew states and
screens did not ([ADR 0011](../../adr/0011-maitty-reads-tickets-and-shows-no-workflow-runs.md)).

GitHub needs none of this. The unmerged `feat/github-repos` branch (MAITTY-326 to 340, also
marked Done and not on `dev`) already reads GitHub through the user's own `gh`: no token is
asked for, kept or sent. Issues use the same route (`gh issue list/view --json`, `gh api`).
That branch has to land on `dev` first.

## The model

One neutral shape the window and the daemon share (pure types in `maitty-shared`):

- **Group**: a place tickets are kept. `kind` is `Project`, `Module`, `Milestone` or `Cycle`;
  it has an id, a name, a parent (a module's project) and a ticket count when the provider
  gives one.
- **TicketSummary**: id (`provider:key`), title, state name and a state *category* (open,
  started, closed), labels, assignee, URL, the group ids it belongs to, updated time.
- **Ticket**: a summary plus the body, comments (capped), links and blocked-by ids.
- **Filter**: group, state category, assignee, label and a search text; paged.

The source is read-only: `groups()`, `list(filter, page)`, `get(id)`.

| Provider | Project and module map to | Reached through | Needs a key from the user |
| --- | --- | --- | --- |
| GitHub | repository → Project; milestone and Projects board → Module | `gh` (signed in once, by the user) | No |
| Plane | project → Project; module → Module (cycles when on) | REST via `curl_http` | Yes: API key, server address, workspace |
| Linear | team → Project; Linear project and cycle → Module, Cycle | GraphQL POST via `curl_http` | Yes: personal API key |

Working a whole module in Plane means choosing its group and getting every open ticket in it;
the same selection is what MAITTY-397 hands to Kitchen.

## Keys and trust

- Maiker stores nothing for GitHub. For Plane and Linear the user adds their own key (and, for
  Plane, server address and workspace); a person's client sends it with `Query::TicketKeys` and the
  daemon holds it in Maiker's data folder, `ticket-keys/<provider>.json` (0600 file, 0700 folder;
  on Windows the user's own app data), never in `config.toml` (synced), a repo, a log, a snapshot,
  an agent's environment or a reply: a client can read back only whether a key is set. A file, not
  the OS keychain, because the daemon runs without a login session on a remote machine and a
  keychain would be a new dependency per platform; the file has the protection of the user's
  account and no more, which [SECURITY](../../SECURITY.md) says. ADR 0006 applies. There is no
  window for it yet.
- Ticket text is written by other people and is untrusted. It is cleaned (control and hidden
  characters dropped), capped, shown as text and never as HTML. When it is sent to an agent it
  is framed as the ticket's words, not instructions, as pull-request comments already are.
- Network and process calls run in the background and report back as messages; a failure is a
  typed error shown to the user (signed out, key refused, unreachable, rate-limited).
- Windows, macOS and Linux must all work; `curl` ships on each, `gh` is the user's own.

## Order

MAITTY-391 (this decision) → land `feat/github-repos` → GitHub provider and the model
(MAITTY-392) → list and page (393) → start an agent (394) → Plane (395) and Linear (396) in
parallel → group, filter and search by project or module.
