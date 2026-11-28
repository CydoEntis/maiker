//! What the daemon and the pane host say to each other (ADR 0022). A host outlives the daemon
//! that started it, and the daemon that comes next may be of another release, so this contract
//! only grows: a new message or a `#[serde(default)]` field, and `HOST_VERSION` with it. Nothing
//! here is ever renamed, retyped or removed.

use serde::{Deserialize, Serialize};
use std::ffi::OsString;
use std::io::{Read, Write};

/// Bumped with each addition, so either side can tell what the other knows.
pub const HOST_VERSION: u32 = 1;

/// The largest frame either side reads: a pane's whole kept output is the biggest one.
pub const MAX_FRAME: usize = 64 * 1024 * 1024;

/// A pane, as the daemon numbers it.
pub type PaneId = u32;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum ToHost {
    Hello {
        version: u32,
    },
    /// Start `argv` in a new pseudo-terminal. `env` is the whole environment (the host's own is
    /// not inherited). `keep` is the daemon's own note about the pane, given back by `List`.
    Spawn {
        id: PaneId,
        argv: Vec<OsString>,
        cwd: Option<OsString>,
        env: Vec<(OsString, OsString)>,
        rows: u16,
        cols: u16,
        /// How much of its output the host keeps for the next daemon.
        kept_bytes: u32,
        #[serde(with = "serde_bytes")]
        keep: Vec<u8>,
    },
    Write {
        id: PaneId,
        #[serde(with = "serde_bytes")]
        data: Vec<u8>,
    },
    Resize {
        id: PaneId,
        rows: u16,
        cols: u16,
    },
    /// End the pane's program and everything it started.
    Kill {
        id: PaneId,
    },
    /// The daemon is done with the pane: it is ended if it still runs, and forgotten.
    Forget {
        id: PaneId,
    },
    /// Every pane, with its kept output. From the answer on, this connection is sent each
    /// pane's output and exit as they happen; a connection that has not asked is sent nothing.
    List,
    /// End every pane and the host itself.
    Shutdown,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum FromHost {
    Welcome {
        version: u32,
        /// The release it was built as, so a daemon of another one can replace an empty host.
        #[serde(default)]
        build: String,
    },
    Spawned {
        id: PaneId,
        pid: Option<u32>,
    },
    SpawnFailed {
        id: PaneId,
        error: String,
    },
    Output {
        id: PaneId,
        #[serde(with = "serde_bytes")]
        data: Vec<u8>,
    },
    /// The pane's output ended (every program holding the terminal closed it).
    OutputEnded {
        id: PaneId,
    },
    /// The pane's program exited; `failed` when it said so.
    Exited {
        id: PaneId,
        failed: bool,
    },
    Panes {
        panes: Vec<HostedPane>,
    },
}

impl FromHost {
    /// Its name alone, for a log: output and kept output stay out of it.
    pub fn kind(&self) -> &'static str {
        match self {
            FromHost::Welcome { .. } => "Welcome",
            FromHost::Spawned { .. } => "Spawned",
            FromHost::SpawnFailed { .. } => "SpawnFailed",
            FromHost::Output { .. } => "Output",
            FromHost::OutputEnded { .. } => "OutputEnded",
            FromHost::Exited { .. } => "Exited",
            FromHost::Panes { .. } => "Panes",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HostedPane {
    pub id: PaneId,
    pub pid: Option<u32>,
    pub rows: u16,
    pub cols: u16,
    #[serde(with = "serde_bytes")]
    pub keep: Vec<u8>,
    /// Its latest output, at most the `kept_bytes` it was started with.
    #[serde(with = "serde_bytes")]
    pub output: Vec<u8>,
    /// Set once its program exited: whether it failed.
    pub exited: Option<bool>,
}

/// One frame: its length as four big-endian bytes, then the named msgpack.
pub fn write_frame<T: Serialize>(out: &mut impl Write, message: &T) -> anyhow::Result<()> {
    let body = rmp_serde::to_vec_named(message)?;
    let len = u32::try_from(body.len()).map_err(|_| anyhow::anyhow!("frame too large"))?;
    out.write_all(&len.to_be_bytes())?;
    out.write_all(&body)?;
    out.flush()?;
    Ok(())
}

/// The next frame, or `None` when the other side closed between frames.
pub fn read_frame<T: serde::de::DeserializeOwned>(input: &mut impl Read) -> anyhow::Result<Option<T>> {
    let mut len = [0u8; 4];
    match input.read_exact(&mut len) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(e.into()),
    }
    let len = u32::from_be_bytes(len) as usize;
    if len > MAX_FRAME {
        anyhow::bail!("a {len}-byte frame is over the limit");
    }
    let mut body = vec![0u8; len];
    input.read_exact(&mut body)?;
    Ok(Some(rmp_serde::from_slice(&body)?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frames_round_trip_and_a_closed_line_is_none() {
        let mut line = Vec::new();
        let spawn = ToHost::Spawn {
            id: 4,
            argv: vec!["sh".into(), "-c".into(), "true".into()],
            cwd: None,
            env: vec![("A".into(), "b".into())],
            rows: 24,
            cols: 80,
            kept_bytes: 1024,
            keep: b"token".to_vec(),
        };
        write_frame(&mut line, &spawn).unwrap();
        write_frame(&mut line, &ToHost::List).unwrap();
        let mut read = line.as_slice();
        assert_eq!(read_frame::<ToHost>(&mut read).unwrap(), Some(spawn));
        assert_eq!(read_frame::<ToHost>(&mut read).unwrap(), Some(ToHost::List));
        assert_eq!(read_frame::<ToHost>(&mut read).unwrap(), None);
    }

    #[test]
    fn an_oversized_frame_is_refused_before_it_is_read() {
        let mut line = (MAX_FRAME as u32 + 1).to_be_bytes().to_vec();
        line.extend([0; 8]);
        assert!(read_frame::<ToHost>(&mut line.as_slice()).is_err());
    }

    /// The first version's shapes are frozen: a host and a daemon of other releases read them.
    #[test]
    fn the_first_versions_shapes_do_not_change() {
        let hello = rmp_serde::to_vec_named(&ToHost::Hello { version: 1 }).unwrap();
        assert_eq!(hello, [0x81, 0xa5, b'H', b'e', b'l', b'l', b'o', 0x81, 0xa7, b'v', b'e', b'r', b's', b'i', b'o', b'n', 0x01]);
        let kill = rmp_serde::to_vec_named(&ToHost::Kill { id: 3 }).unwrap();
        assert_eq!(kill, [0x81, 0xa4, b'K', b'i', b'l', b'l', 0x81, 0xa2, b'i', b'd', 0x03]);
    }
}
