# Spec: tickets in the app

Type: feature · Status: in progress. The model, the read-only GitHub provider (MAITTY-392) and the read-only Plane (MAITTY-395) and Linear (MAITTY-396) providers are built, with the shared `curl` sender and the daemon's key store: `maitty_shared::tickets`, `daemon/tickets_github.rs`, `tickets_plane.rs`, `tickets_linear.rs`, `ticket_keys.rs`, `Query::Tickets` (protocol 105) and `Query::TicketKeys` (protocol 106); the desktop Tickets view and Settings › Tickets are built (UI › *Tickets view*); Plane and Linear are not yet checked against a live server · Decision from MAITTY-391 · Date: 2026-11-14

Read your tickets from GitHub, Plane and Linear inside Maitty: browse by project or module,
search and filter, open one with its comments, start an agent on it, and later hand a group to
Kitchen. Read-only to begin with; the only planned write is a confirmed comment or "done"
(MAITTY-398). Tickets: Plane module "Tickets in the app" (MAITTY-391 to 398, plus the grouping
ticket filed with this spec).

## Decision: what to reuse from `feat/project-crews`

The crews branch (local only, 24 commits, 182 files) holds a tracker for a different feature:
a captain that writes and moves tickets for crewmates. Plane marks MAITTY-247 and 248 Done, but
none of it is on `dev`. Do not merge the branch; the crew screens are unmounted and superseded
by the redesign ([FEATURES](../../FEATURES.md)).

| Piece on the branch | Decision | Why |
| --- | --- | --- |
| `maitty-core/src/curl_http.rs` (the system `curl`, token on stdin, no redirects, 20 s, 4 MiB cap) | **Cherry-pick** | Adds no HTTP dependency; its security rules are already written. Needed by Plane and Linear. |
| In `maitty-tracker-plane`: `Http`, `Secret`, `check_base_url`, `text.rs` cleaning, paging, rate-limit wait, fake-`Http` tests | **Reuse as a pattern** (copy what fits) | The Plane REST details (state ids, paging, 429 wait, the blocked-by relations endpoint) are already worked out. |
| `maitty-shared/src/tracker.rs` (`Ticket`, `TicketState`, `NewTicket`, `Tracker`) | **Rewrite** | Its states are crew states (`SaysDone`, `Verified`), an assignee is a crewmate, and it creates and moves tickets. We need a read-only, provider-neutral model with groups and comments. |
| `local_tracker.rs`, crew UI | **Leave** | Not part of this feature. |

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

The source is read-only: `groups()`, `list(filter, page)`, `get(id)`. A write is a separate
trait added only by MAITTY-398.

| Provider | Project and module map to | Reached through | Needs a key from the user |
| --- | --- | --- | --- |
| GitHub | repository → Project; milestone and Projects board → Module | `gh` (signed in once, by the user) | No |
| Plane | project → Project; module → Module (cycles when on) | REST via `curl_http` | Yes: API key, server address, workspace |
| Linear | team → Project; Linear project and cycle → Module, Cycle | GraphQL POST via `curl_http` | Yes: personal API key |

Working a whole module in Plane means choosing its group and getting every open ticket in it;
the same selection is what MAITTY-397 hands to Kitchen.

## Keys and trust

- Maitty stores nothing for GitHub. For Plane and Linear the user adds their own key (and, for
  Plane, server address and workspace); a person's client sends it with `Query::TicketKeys` and the
  daemon holds it in Maitty's data folder, `ticket-keys/<provider>.json` (0600 file, 0700 folder;
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
parallel → group, filter and search by project or module → hand to Kitchen (397) → confirmed
writes (398).
