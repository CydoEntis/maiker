//! Whether an agent's tool calls in a turn are one call over and over, or two taking turns.
//!
//! The daemon sees each call only as a fingerprint (`ClientMsg::Hook::call`), so this can say that
//! a call repeats and never what the call was.

/// One call this many times in a row is repeating.
pub(super) const SAME_CALLS_IN_A_ROW: u32 = 5;
/// Two calls taking turns, this many calls long, is repeating.
pub(super) const TURN_TAKING_CALLS: u32 = 8;
/// The length of a fingerprint, in hex characters.
const FINGERPRINT_HEX: usize = 16;

/// A fingerprint a hook reported, checked: exactly 16 hex characters, else `None`.
pub(super) fn parse_call(call: &str) -> Option<u64> {
    if call.len() != FINGERPRINT_HEX || !call.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return None;
    }
    u64::from_str_radix(call, 16).ok()
}

/// The tail of a turn's calls, enough to tell a repeat as it grows.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub(super) struct CallRun {
    last: Option<u64>,
    before: Option<u64>,
    same: u32,
    taking_turns: u32,
}

impl CallRun {
    /// The agent started this call.
    pub(super) fn push(&mut self, call: u64) {
        self.same = if self.last == Some(call) { self.same + 1 } else { 1 };
        self.taking_turns = match (self.last, self.before) {
            (Some(last), Some(before)) if last != call && before == call => self.taking_turns + 1,
            (Some(last), _) if last != call => 2,
            _ => 1,
        };
        self.before = self.last;
        self.last = Some(call);
    }

    /// How many calls the repeat has reached, while one is going on.
    pub(super) fn repeats(&self) -> Option<u32> {
        if self.same >= SAME_CALLS_IN_A_ROW {
            Some(self.same)
        } else if self.taking_turns >= TURN_TAKING_CALLS {
            Some(self.taking_turns)
        } else {
            None
        }
    }

    /// A new prompt, the turn ending, or the agent leaving: nothing carries over.
    pub(super) fn clear(&mut self) {
        *self = Self::default();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(calls: &[u64]) -> CallRun {
        let mut run = CallRun::default();
        for call in calls {
            run.push(*call);
        }
        run
    }

    #[test]
    fn one_call_over_and_over_or_two_taking_turns_repeats_past_its_threshold() {
        let turns = |n: usize| (0..n).map(|i| if i % 2 == 0 { 1 } else { 2 }).collect::<Vec<u64>>();
        let mut third_breaks_turns = turns(8);
        third_breaks_turns.push(3);
        let cases: [(&str, Vec<u64>, Option<u32>); 11] = [
            ("four of the same call is nothing", vec![7; 4], None),
            ("five is five", vec![7; 5], Some(5)),
            ("it grows while the same call goes on", vec![7; 6], Some(6)),
            ("and on", vec![7; 12], Some(12)),
            ("a different call clears it", vec![7, 7, 7, 7, 7, 8], None),
            ("five after others counts from where it began", vec![1, 2, 3, 7, 7, 7, 7, 7], Some(5)),
            ("seven taking turns is nothing", turns(7), None),
            ("eight taking turns is eight", turns(8), Some(8)),
            ("and grows", turns(9), Some(9)),
            ("a third call breaks taking turns", third_breaks_turns, None),
            ("many different calls are never a repeat", (0..40).collect(), None),
        ];
        for (what, calls, want) in cases {
            assert_eq!(run(&calls).repeats(), want, "{what}");
        }
    }

    #[test]
    fn clearing_forgets_everything() {
        let mut calls = run(&[7; 6]);
        calls.clear();
        assert_eq!(calls.repeats(), None);
        calls.push(7);
        assert_eq!(calls.repeats(), None, "one call after a clear is the first");
    }

    #[test]
    fn a_fingerprint_is_sixteen_hex_characters_and_nothing_else() {
        assert_eq!(parse_call("00112233445566ff"), Some(0x0011_2233_4455_66ff));
        assert_eq!(parse_call("ffffffffffffffff"), Some(u64::MAX));
        for bad in ["", "0011", "00112233445566f", "00112233445566fff", "0011223344556zzz", "+0112233445566ff", "00112233 45566ff", "０011223344556677"] {
            assert_eq!(parse_call(bad), None, "{bad:?}");
        }
    }
}
