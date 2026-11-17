//! Asking an agent's own program what it offers: Claude Code for its models and its slash
//! commands, Codex for its skills. Both the desktop app (for this computer) and a daemon (for the
//! machine it runs on, ADR 0007) ask this way, so the questions and the cleaning of the answers
//! live in one place. It never depends on `maitty-core`.

pub mod claude;
pub mod codex;
pub mod pinned;
