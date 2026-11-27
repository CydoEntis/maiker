# Architecture decision records

An ADR records a decision that is expensive to reverse, along with the context
that made it the right call when it was made. Examples include the choice of
framework, persistence engine, auth model, architecture style, or module
boundary.

Don't write ADRs for ordinary implementation details, and not for how the UI looks or which
key does what. Those belong in code, tests, `docs/DESIGN.md`, `docs/shortcuts.md`, and commit
messages.

## How to add one

1. Copy [`0000-template.md`](0000-template.md) to `NNNN-short-title.md`, using
   the next number.
2. Fill it in. Set the status to `Proposed` until the user accepts it.
3. Add a row to the index below.
4. Update the project-specific section of the doc that owns the topic, with a
   one-line summary and a link.

To change a decision, edit its ADR in the same change and say why in the commit message. Git
holds the history; an ADR states only what is true now.

## Index

| # | Decision |
| --- | --- |
| [0001](0001-the-daemon-owns-every-session.md) | The daemon owns every session and conversation, and only one daemon runs |
| [0002](0002-terminal-substrate-and-wire-protocol.md) | portable-pty and vt100; msgpack over local sockets, versioned |
| [0003](0003-status-and-conversation-trust.md) | Status comes only from the owning runtime, and one writer decides it |
| [0004](0004-client-split-and-desktop-host.md) | Clients are views: TUI, CLI and an optional desktop app, sharing one installed daemon |
| [0005](0005-provider-adapters-and-permissions.md) | Provider adapters sit behind the daemon; only a person changes permissions |
| [0006](0006-secrets-never-enter-chat.md) | Secrets never enter chat |
| [0007](0007-multiple-machines.md) | One connection per machine, held by the client (the disk-reading limit amended by 0014, reaching and adding a machine by 0017) |
| [0008](0008-windows-first-and-one-product-name.md) | Windows is first-class; the product name lives in one place |
| [0009](0009-usage-is-provider-reported-never-estimated.md) | Usage is what the provider reported, never estimated |
| [0010](0010-workflows-and-specialist-agents-stay-outside-maitty.md) | Workflows and specialist agents stay outside Maiker; Maiker shows the specialists |
| [0011](0011-maitty-reads-tickets-and-shows-no-workflow-runs.md) | Maiker only reads tickets and shows no workflow runs (the tickets part superseded by 0013) |
| [0012](0012-brand-names-live-in-one-place-and-env-has-a-generic-prefix.md) | Brand-dependent names live in one place; environment variables have a generic prefix |
| [0013](0013-no-in-app-tickets.md) | Maiker has no in-app tickets; they live in their tracker |
| [0014](0014-markdown-documents-on-other-machines.md) | Markdown documents are read and saved on other machines, by that machine's own daemon |
| [0015](0015-worktrees-live-in-one-folder-under-home.md) | Worktrees live in one folder under home, grouped by project and named for the task |
| [0016](0016-a-chat-asks-before-it-starts-helpers.md) | A chat asks before it starts helpers, and the consent belongs to the conversation |
| [0017](0017-remote-machines-rely-on-your-ssh-setup.md) | Remote machines rely on your own ssh setup and trust a new host key once |
| [0018](0018-one-provider-contract-with-no-io.md) | Every provider is one dialect with no I/O, named in one registry |
| [0019](0019-acp-for-agents-without-an-adapter.md) | ACP is for agents without an adapter, and what it claims is labelled |
| [0020](0020-the-chat-view-talks-to-the-agent-directly.md) | The chat view talks to the agent directly, never through a terminal |
| [0021](0021-acp-agents-are-installed-from-the-registry.md) | Agents run over ACP are installed from the ACP registry |
| [0022](0022-a-pane-host-keeps-terminals-running-across-an-update.md) | A pane host keeps terminals running across a daemon update (proposed) |
