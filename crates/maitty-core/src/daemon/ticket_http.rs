//! What the keyed ticket providers (Plane, Linear) share when they talk over `Http`: how a failure
//! to be answered and an answer's status become a `TicketError`, and how an answer's text becomes
//! JSON. Every error is a fixed line; the server's own words, which can echo a request, are never
//! passed on, and neither is the key.

use crate::http::HttpError;
use maitty_shared::tickets::{TicketError, clean_line};
use serde_json::Value;

impl From<HttpError> for TicketError {
    fn from(error: HttpError) -> TicketError {
        match error {
            HttpError::BadRequest => TicketError::Invalid(error.to_string()),
            HttpError::TooLarge => TicketError::Invalid(error.to_string()),
            HttpError::NoCurl | HttpError::Unreachable(_) => TicketError::Unreachable(error.to_string()),
        }
    }
}

/// The error for an answer whose status was not a success.
pub(super) fn status_error(status: u16) -> TicketError {
    match status {
        401 | 403 => TicketError::SignedOut,
        404 => TicketError::NotFound,
        429 => TicketError::RateLimited,
        500..=599 => TicketError::Unreachable("The server had an error".into()),
        _ => TicketError::Invalid("The server did not accept the request".into()),
    }
}

/// An answer's body as JSON, or the fixed line that says it was not.
pub(super) fn parse_json(body: &str) -> Result<Value, TicketError> {
    serde_json::from_str(body).map_err(|_| TicketError::Invalid("The server did not give tickets".into()))
}

/// A part of a filter that is words a person typed: `None` when there are none, the words in lower
/// case when they are plain (no control or hidden characters, at most `max` characters), else the
/// fixed line that says what was not.
pub(super) fn plain_words(text: &Option<String>, max: usize, what: &str) -> Result<Option<String>, TicketError> {
    match text.as_deref().map(str::trim) {
        None | Some("") => Ok(None),
        Some(text) if text.chars().count() <= max && clean_line(text, usize::MAX) == text => Ok(Some(text.to_lowercase())),
        Some(_) => Err(TicketError::Invalid(format!("That is not {what}"))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_failure_is_a_fixed_line_and_a_refused_key_is_signed_out() {
        assert_eq!(TicketError::from(HttpError::TooLarge), TicketError::Invalid("The answer is larger than can be read".into()));
        assert!(matches!(TicketError::from(HttpError::NoCurl), TicketError::Unreachable(_)));
        assert!(matches!(TicketError::from(HttpError::Unreachable("The server could not be reached")), TicketError::Unreachable(line) if line.contains("could not be reached")));
        assert_eq!((status_error(401), status_error(403), status_error(404), status_error(429)), (TicketError::SignedOut, TicketError::SignedOut, TicketError::NotFound, TicketError::RateLimited));
        assert!(matches!(status_error(502), TicketError::Unreachable(_)));
        assert!(matches!(status_error(400), TicketError::Invalid(_)));
        assert!(parse_json("{").is_err() && parse_json("[1]").is_ok());
    }
}
