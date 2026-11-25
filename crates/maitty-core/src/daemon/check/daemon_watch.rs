//! Linux: a check dies with the daemon that started it, however the daemon goes.
//!
//! The parent-death signal alone does not hold. It is one process's setting: every child the
//! check's shell forks starts without it, and the kernel clears it when the shell, or anything it
//! `exec`s in its place, is a set-user-id, set-group-id or file-capability program or changes
//! security domain (`secureexec`). So beside it, each check gets a watcher: a small process forked
//! before the check's `exec`, a member of the check's process group and nobody's child in it, that
//! blocks reading one end of a socket pair whose other end only the daemon holds. When the daemon goes,
//! the kernel closes that end, the read returns end-of-file, and the watcher kills the check's
//! process group, itself included. When the check ends first, the daemon sends one byte and the
//! watcher leaves without touching anything.

use std::io;
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd, RawFd};
use std::process::Command;

/// The watcher's process name (at most 15 bytes and a NUL), so `ps` does not show a second daemon.
const WATCHER_NAME: &[u8] = b"check-watch\0";
/// What the daemon sends when the check ended on its own.
const RELEASE: u8 = 1;
/// The highest signal number whose handler the watcher sets back to the default.
const LAST_STANDARD_SIGNAL: libc::c_int = 31;

/// The daemon's end of one check's watch. Dropping it without `release` is the daemon going: the
/// watcher stops the check.
#[derive(Debug)]
pub(super) struct DaemonWatch {
    daemon_end: OwnedFd,
}

impl DaemonWatch {
    /// Sets `c` up to die with this process: the parent-death signal, and a watcher started
    /// between fork and exec.
    pub(super) fn arm(c: &mut Command) -> io::Result<Self> {
        let (daemon_end, check_end) = socket_pair()?;
        let daemon = std::process::id() as libc::pid_t;
        // SAFETY: runs between fork and exec in a child with one thread, and calls only
        // async-signal-safe functions; it allocates nothing and takes no lock.
        unsafe {
            std::os::unix::process::CommandExt::pre_exec(c, move || {
                libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGKILL as libc::c_ulong);
                // The daemon may have died before the signal was armed, and the signal never fires then.
                if libc::getppid() != daemon {
                    libc::_exit(1);
                }
                // The check leads its own group (`process_group(0)` asks the same); the watcher
                // joins it, so the group, and the number the watcher signals, live as long as it.
                if libc::setpgid(0, 0) != 0 {
                    return Err(io::Error::last_os_error());
                }
                start_watcher(check_end.as_raw_fd(), libc::getpid())
            });
        }
        Ok(Self { daemon_end })
    }

    /// The check ended on its own: its watcher leaves and stops nothing, so what the check left
    /// running in the background is treated as before. A watcher already gone (the check's group
    /// was killed) is no error.
    pub(super) fn release(self) {
        let byte = [RELEASE];
        // SAFETY: sends one byte from a live buffer on a socket this value owns.
        unsafe {
            libc::send(
                self.daemon_end.as_raw_fd(),
                byte.as_ptr().cast(),
                byte.len(),
                libc::MSG_NOSIGNAL,
            )
        };
    }
}

fn socket_pair() -> io::Result<(OwnedFd, OwnedFd)> {
    let mut fds = [0 as RawFd; 2];
    // SAFETY: `fds` has room for the two descriptors the call writes.
    let made = unsafe {
        libc::socketpair(
            libc::AF_UNIX,
            libc::SOCK_STREAM | libc::SOCK_CLOEXEC,
            0,
            fds.as_mut_ptr(),
        )
    };
    if made != 0 {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: the call succeeded, so both descriptors are open and owned by nothing else.
    Ok(unsafe { (OwnedFd::from_raw_fd(fds[0]), OwnedFd::from_raw_fd(fds[1])) })
}

/// Starts the watcher from the check's child and waits for the go-between that started it, so the
/// watcher is nobody's child in the check: a program there that waits for every child it has
/// never waits for it.
///
/// # Safety
/// Only between fork and exec, with the same rules as `pre_exec`.
unsafe fn start_watcher(watched: RawFd, group: libc::pid_t) -> io::Result<()> {
    // SAFETY: async-signal-safe calls in a child with one thread (see `arm`).
    unsafe {
        let go_between = libc::fork();
        if go_between < 0 {
            return Err(io::Error::last_os_error());
        }
        if go_between == 0 {
            let watcher = libc::fork();
            if watcher == 0 {
                watch(watched, group);
            }
            libc::_exit(if watcher < 0 { 1 } else { 0 });
        }
        let mut status = 0;
        while libc::waitpid(go_between, &mut status, 0) < 0 {
            let error = io::Error::last_os_error();
            if error.raw_os_error() != Some(libc::EINTR) {
                return Err(error);
            }
        }
        if libc::WIFEXITED(status) && libc::WEXITSTATUS(status) == 0 {
            Ok(())
        } else {
            Err(io::Error::from_raw_os_error(libc::EAGAIN))
        }
    }
}

/// The watcher: waits for the daemon's word or its end, and on its end kills the check's group.
///
/// # Safety
/// Only in the watcher process `start_watcher` forked.
unsafe fn watch(watched: RawFd, group: libc::pid_t) -> ! {
    // SAFETY: async-signal-safe calls in a process with one thread that never returns.
    unsafe {
        libc::prctl(libc::PR_SET_NAME, WATCHER_NAME.as_ptr());
        // The daemon's handlers would write to files closed below; a signal does what it says.
        for signal in 1..=LAST_STANDARD_SIGNAL {
            libc::signal(signal, libc::SIG_DFL);
        }
        // Only the watched end stays open: the daemon's sockets, locks and terminals, and the
        // check's output pipes, must close when they would have without the watcher.
        if libc::dup2(watched, 0) < 0 {
            libc::_exit(1);
        }
        close_from(1);
        let mut byte = 0u8;
        loop {
            match libc::read(0, (&raw mut byte).cast(), 1) {
                1 => libc::_exit(0),
                0 => {
                    libc::kill(-group, libc::SIGKILL);
                    libc::_exit(0);
                }
                _ if io::Error::last_os_error().raw_os_error() == Some(libc::EINTR) => {}
                _ => libc::_exit(1),
            }
        }
    }
}

/// Closes every descriptor from `first` up.
///
/// # Safety
/// Only in the watcher, which uses nothing it closes.
unsafe fn close_from(first: libc::c_uint) {
    // SAFETY: plain system calls on this process's own descriptors.
    unsafe {
        if libc::syscall(libc::SYS_close_range, first, libc::c_uint::MAX, 0) == 0 {
            return;
        }
        // A kernel older than 5.9 has no `close_range`.
        let mut limit: libc::rlimit = std::mem::zeroed();
        let last = if libc::getrlimit(libc::RLIMIT_NOFILE, &mut limit) == 0 {
            limit.rlim_cur.min(libc::c_int::MAX as libc::rlim_t) as libc::c_int
        } else {
            libc::c_int::from(u16::MAX)
        };
        for fd in first as libc::c_int..last {
            libc::close(fd);
        }
    }
}
