//! The Agent Client Protocol, version 1, as a provider dialect: for an agent that has no adapter
//! of its own. The rules are in `docs/stack/acp.md`.

pub mod dialect;
mod envelope;
mod updates;
mod wire;

pub use dialect::{AcpDialect, Settings};

/// The longest line an agent may write, like every provider's.
pub const MAX_FRAME_BYTES: usize = 1024 * 1024;
