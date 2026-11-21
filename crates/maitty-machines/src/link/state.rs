//! One machine's connection state and the rules that move it. Pure: the time is passed in, so
//! the table is tested without a clock, and nothing here dials or sleeps.

use crate::link_failure::FailureClass;
use std::time::{Duration, Instant};

/// Dials after a drop that still read as "reconnecting": a blip is not an outage. Past them
/// the machine is called unreachable, and its dials carry on quietly.
pub const RECONNECT_DIALS: u32 = 3;

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub enum ConnectionState {
    /// The first dial of this run.
    #[default]
    Connecting,
    Connected,
    /// A line that was up dropped, and the dial to bring it back is `attempt`.
    Reconnecting {
        attempt: u32,
        since: Instant,
    },
    /// ssh needs a login it cannot do without a person: a refused key, a password or second
    /// code, or a host key ssh refused, changed or not yet known (`FailureClass::is_login`).
    NeedsLogin {
        failure: FailureClass,
    },
    /// The far side needs another version of the app (or none installed): a person acts.
    NeedsUpdate {
        failure: FailureClass,
    },
    /// The machine does not answer; dials carry on in the background.
    Unreachable {
        since: Instant,
        failure: FailureClass,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Event {
    ConnectOk,
    /// The line that was up closed.
    LineDropped,
    ConnectFailed(FailureClass),
    /// A person asked to try again now.
    Retry,
    /// The line went silent mid-frame (see `connections`).
    WatchdogFired,
    /// The window turned the machine away: a different daemon answers at its name.
    Refused(String),
}

pub fn next(state: &ConnectionState, event: Event, now: Instant) -> ConnectionState {
    use ConnectionState::*;
    match (state, event) {
        (_, Event::ConnectOk) => Connected,
        (_, Event::Refused(why)) => Unreachable {
            since: now,
            failure: FailureClass::Refused(why),
        },
        (Connected, Event::LineDropped | Event::WatchdogFired) => Reconnecting {
            attempt: 1,
            since: now,
        },
        (Reconnecting { attempt, since }, Event::ConnectFailed(FailureClass::Unreachable(_)))
            if *attempt < RECONNECT_DIALS =>
        {
            Reconnecting {
                attempt: attempt + 1,
                since: *since,
            }
        }
        (Reconnecting { since, .. } | Unreachable { since, .. }, Event::ConnectFailed(class)) => {
            failed(class, *since)
        }
        (Connecting | NeedsLogin { .. } | NeedsUpdate { .. }, Event::ConnectFailed(class)) => {
            failed(class, now)
        }
        (Unreachable { .. } | NeedsLogin { .. } | NeedsUpdate { .. }, Event::Retry) => {
            Reconnecting {
                attempt: 1,
                since: now,
            }
        }
        _ => state.clone(),
    }
}

fn failed(failure: FailureClass, since: Instant) -> ConnectionState {
    use ConnectionState::*;
    match failure {
        failure if failure.is_login() => NeedsLogin { failure },
        FailureClass::Update
        | FailureClass::UpdateHere
        | FailureClass::Install
        | FailureClass::InstallFailed(_) => NeedsUpdate { failure },
        failure => Unreachable { since, failure },
    }
}

impl ConnectionState {
    /// The two states of one kind are the same news; only a change of kind is worth a toast.
    pub fn kind(&self) -> &'static str {
        match self {
            ConnectionState::Connecting => "connecting",
            ConnectionState::Connected => "connected",
            ConnectionState::Reconnecting { .. } => "reconnecting",
            ConnectionState::NeedsLogin { .. } => "needs-login",
            ConnectionState::NeedsUpdate { .. } => "needs-update",
            ConnectionState::Unreachable { .. } => "unreachable",
        }
    }

    pub fn is_connected(&self) -> bool {
        matches!(self, ConnectionState::Connected)
    }

    /// A machine that was reached and is not now. Its agents stay in the sidebar, greyed.
    pub fn is_down(&self) -> bool {
        matches!(
            self,
            ConnectionState::Reconnecting { .. }
                | ConnectionState::NeedsLogin { .. }
                | ConnectionState::NeedsUpdate { .. }
                | ConnectionState::Unreachable { .. }
        )
    }

    /// Why the machine is not connected, for the states a failure put it in.
    pub fn failure(&self) -> Option<&FailureClass> {
        match self {
            ConnectionState::NeedsLogin { failure }
            | ConnectionState::NeedsUpdate { failure }
            | ConnectionState::Unreachable { failure, .. } => Some(failure),
            _ => None,
        }
    }

    /// When the line was lost, for the states that remember it.
    pub fn since(&self) -> Option<Instant> {
        match self {
            ConnectionState::Reconnecting { since, .. }
            | ConnectionState::Unreachable { since, .. } => Some(*since),
            _ => None,
        }
    }
}

/// How long to wait before dial number `failures + 1`: none for the first (a line that was
/// up, or the first ever), then `first`, doubling up to `most`. A success resets `failures`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Backoff {
    pub first: Duration,
    pub most: Duration,
}

impl Backoff {
    pub const DEFAULT: Backoff = Backoff {
        first: Duration::from_millis(250),
        most: Duration::from_secs(30),
    };

    pub fn delay(&self, failures: u32) -> Duration {
        let Some(doublings) = failures.checked_sub(1) else {
            return Duration::ZERO;
        };
        self.first
            .saturating_mul(1u32.checked_shl(doublings).unwrap_or(u32::MAX))
            .min(self.most)
    }
}

#[cfg(test)]
mod tests {
    use super::ConnectionState::*;
    use super::*;

    fn at(secs: u64) -> Instant {
        static BASE: std::sync::OnceLock<Instant> = std::sync::OnceLock::new();
        *BASE.get_or_init(Instant::now) + Duration::from_secs(secs)
    }

    const SAID: &str = "box: Permission denied (publickey).";

    fn unreachable(why: &str) -> FailureClass {
        FailureClass::Unreachable(why.into())
    }

    fn run(from: ConnectionState, events: &[(Event, u64)]) -> ConnectionState {
        events.iter().fold(from, |state, (event, secs)| {
            next(&state, event.clone(), at(*secs))
        })
    }

    #[test]
    fn a_first_connection_succeeds_or_is_classified() {
        assert_eq!(run(Connecting, &[(Event::ConnectOk, 0)]), Connected);
        assert_eq!(
            run(
                Connecting,
                &[(Event::ConnectFailed(FailureClass::KeyRefused(SAID.into())), 5)]
            ),
            NeedsLogin {
                failure: FailureClass::KeyRefused(SAID.into())
            }
        );
        assert_eq!(
            run(
                Connecting,
                &[(Event::ConnectFailed(unreachable("down")), 5)]
            ),
            Unreachable {
                since: at(5),
                failure: unreachable("down")
            }
        );
    }

    #[test]
    fn a_line_that_drops_is_reconnecting_whatever_dropped_it() {
        for event in [Event::LineDropped, Event::WatchdogFired] {
            assert_eq!(
                run(Connected, &[(event, 7)]),
                Reconnecting {
                    attempt: 1,
                    since: at(7)
                }
            );
        }
    }

    #[test]
    fn reconnecting_returns_to_connected_on_success() {
        let state = run(Connected, &[(Event::LineDropped, 1), (Event::ConnectOk, 2)]);
        assert_eq!(state, Connected);
    }

    #[test]
    fn a_few_failed_dials_still_read_as_reconnecting_then_the_machine_is_unreachable() {
        let mut events = vec![(Event::LineDropped, 10)];
        events.extend((0..RECONNECT_DIALS - 1).map(|i| {
            (
                Event::ConnectFailed(unreachable("no route")),
                11 + u64::from(i),
            )
        }));
        assert_eq!(
            run(Connected, &events),
            Reconnecting {
                attempt: RECONNECT_DIALS,
                since: at(10)
            }
        );
        events.push((Event::ConnectFailed(unreachable("no route")), 20));
        assert_eq!(
            run(Connected, &events),
            Unreachable {
                since: at(10),
                failure: unreachable("no route")
            },
            "unreachable counts from when the line dropped"
        );
    }

    #[test]
    fn unreachable_keeps_its_since_while_the_why_follows_the_latest_failure() {
        let state = run(
            Unreachable {
                since: at(3),
                failure: unreachable("old"),
            },
            &[(Event::ConnectFailed(unreachable("new")), 90)],
        );
        assert_eq!(
            state,
            Unreachable {
                since: at(3),
                failure: unreachable("new")
            }
        );
    }

    #[test]
    fn a_failure_that_needs_a_person_wins_over_a_blip() {
        let dropped = &[(Event::LineDropped, 1)];
        let then = |class| {
            let mut events = dropped.to_vec();
            events.push((Event::ConnectFailed(class), 2));
            run(Connected, &events)
        };
        assert_eq!(
            then(FailureClass::KeyRefused(SAID.into())),
            NeedsLogin {
                failure: FailureClass::KeyRefused(SAID.into())
            }
        );
        assert_eq!(
            then(FailureClass::Update),
            NeedsUpdate {
                failure: FailureClass::Update
            }
        );
        assert_eq!(
            then(FailureClass::Install),
            NeedsUpdate {
                failure: FailureClass::Install
            }
        );
        assert_eq!(
            then(FailureClass::HostKeyChanged { known_as: None }),
            NeedsLogin {
                failure: FailureClass::HostKeyChanged { known_as: None }
            },
            "a changed host key waits for a person, it is not redialled"
        );
        assert_eq!(
            then(FailureClass::HostKeyUnknown),
            NeedsLogin {
                failure: FailureClass::HostKeyUnknown
            },
            "a new host key the person's config refused waits for a person too"
        );
        assert_eq!(
            then(FailureClass::NeedsPerson(SAID.into())),
            NeedsLogin {
                failure: FailureClass::NeedsPerson(SAID.into())
            }
        );
        assert_eq!(
            then(FailureClass::NoDaemon),
            Unreachable {
                since: at(1),
                failure: FailureClass::NoDaemon
            }
        );
    }

    #[test]
    fn a_state_that_needs_a_person_moves_on_when_the_failure_changes_or_clears() {
        let login = NeedsLogin {
                failure: FailureClass::KeyRefused(SAID.into())
            };
        assert_eq!(
            run(
                login.clone(),
                &[(Event::ConnectFailed(FailureClass::KeyRefused(SAID.into())), 9)]
            ),
            login,
            "the same failure again changes nothing"
        );
        assert_eq!(
            run(
                login.clone(),
                &[(Event::ConnectFailed(FailureClass::Update), 9)]
            ),
            NeedsUpdate {
                failure: FailureClass::Update
            }
        );
        assert_eq!(run(login, &[(Event::ConnectOk, 9)]), Connected);
    }

    #[test]
    fn a_retry_shows_reconnecting_from_any_failed_state() {
        for failed in [
            NeedsLogin { failure: FailureClass::NeedsPerson("y".into()) },
            NeedsUpdate { failure: FailureClass::Update },
            Unreachable {
                since: at(1),
                failure: unreachable("x"),
            },
        ] {
            assert_eq!(
                run(failed, &[(Event::Retry, 40)]),
                Reconnecting {
                    attempt: 1,
                    since: at(40)
                }
            );
        }
    }

    #[test]
    fn a_machine_turned_away_is_unreachable_with_the_reason() {
        assert_eq!(
            run(Connected, &[(Event::Refused("another machine".into()), 4)]),
            Unreachable {
                since: at(4),
                failure: FailureClass::Refused("another machine".into())
            }
        );
    }

    #[test]
    fn events_that_do_not_apply_change_nothing() {
        assert_eq!(run(Connected, &[(Event::Retry, 1)]), Connected);
        assert_eq!(
            run(Connected, &[(Event::ConnectFailed(unreachable("x")), 1)]),
            Connected
        );
        assert_eq!(run(Connecting, &[(Event::LineDropped, 1)]), Connecting);
        let down = Unreachable {
            since: at(1),
            failure: unreachable("x"),
        };
        assert_eq!(run(down.clone(), &[(Event::WatchdogFired, 2)]), down);
    }

    #[test]
    fn the_backoff_doubles_from_250_ms_to_30_s_and_stays() {
        let waits: Vec<u128> = (0..12)
            .map(|failures| Backoff::DEFAULT.delay(failures).as_millis())
            .collect();
        assert_eq!(
            waits,
            [
                0, 250, 500, 1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000, 30000
            ]
        );
        assert_eq!(Backoff::DEFAULT.delay(u32::MAX).as_millis(), 30000);
    }

    #[test]
    fn a_line_that_was_up_is_redialled_at_once_and_success_resets_the_wait() {
        // The supervisor starts every outage at zero failures and zeroes it on success.
        assert_eq!(Backoff::DEFAULT.delay(0), Duration::ZERO);
        assert_eq!(Backoff::DEFAULT.delay(1), Backoff::DEFAULT.first);
    }

    #[test]
    fn only_a_change_of_kind_is_news() {
        assert_eq!(Connected.kind(), "connected");
        assert_eq!(
            Unreachable {
                since: at(1),
                failure: unreachable("a")
            }
            .kind(),
            Unreachable {
                since: at(2),
                failure: unreachable("b")
            }
            .kind()
        );
        assert_ne!(Connecting.kind(), Connected.kind());
    }
}
