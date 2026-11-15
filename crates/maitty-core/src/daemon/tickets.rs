//! Which provider answers a `Query::Tickets`. The request's `source` says: `owner/name` is a GitHub
//! repository (read with the machine's own `gh`), `plane` and `linear` are the providers that read
//! with a key the user kept (`ticket_keys`). One that has no key kept answers `NotInstalled`, the
//! answer a client turns into "add your key".

use super::ticket_keys::{KeyStore, Saved};
use super::{tickets_github, tickets_plane};
use crate::curl_http::CurlHttp;
use maitty_shared::tickets::{TicketError, TicketProvider, TicketsReply, TicketsRequest};

/// What a client asked of `source`'s tickets. Blocks while the provider answers.
pub(super) fn answer(source: &str, request: TicketsRequest) -> Result<TicketsReply, TicketError> {
    let Some(provider) = TicketProvider::from_source(source) else {
        return tickets_github::answer(source, request);
    };
    let saved = keyed(&KeyStore::real(), provider)?;
    match provider {
        TicketProvider::Plane => tickets_plane::answer(&CurlHttp, &saved, request, tickets_plane::RETRY_WAIT),
        TicketProvider::Linear => Err(TicketError::Invalid("Linear is not read yet".into())),
    }
}

/// The key kept for `provider`, or `NotInstalled` when none is.
fn keyed(store: &KeyStore, provider: TicketProvider) -> Result<Saved, TicketError> {
    store.load(provider)?.ok_or(TicketError::NotInstalled)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_provider_with_no_key_kept_is_not_set_up_and_a_repository_is_not_a_provider() {
        let root = crate::daemon::persist::scratch_dir();
        let store = KeyStore::at(root.path().join("ticket-keys"));
        assert_eq!(keyed(&store, TicketProvider::Plane).unwrap_err(), TicketError::NotInstalled);
        assert_eq!(TicketProvider::from_source("plane"), Some(TicketProvider::Plane));
        assert_eq!(TicketProvider::from_source("linear"), Some(TicketProvider::Linear));
        for repository in ["me/widgets", "plane/x", "Plane", ""] {
            assert_eq!(TicketProvider::from_source(repository), None, "{repository}");
        }
    }
}
