//! The one seam between a ticket provider and the network: a request, a response, and the trait
//! something that really talks HTTP implements (`curl_http::CurlHttp`). A provider never opens a
//! connection itself, so its logic is tested against a fake and the daemon decides how a request
//! is sent. Everything here is written for a request that carries a key: the key is a `Secret`
//! that never prints, a failure is one of a few fixed lines that name neither the key nor the
//! server's own words, and an address is checked before a key may be sent to it.

use std::fmt;

/// A credential. It never shows in `Debug` or `Display` output, so a logged request cannot leak it.
#[derive(Clone, PartialEq, Eq)]
pub struct Secret(String);

impl Secret {
    pub fn new(value: impl Into<String>) -> Secret {
        Secret(value.into())
    }

    /// The value, for the one place that must send it.
    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for Secret {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Secret(..)")
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Method {
    Get,
    Post,
    Patch,
}

impl Method {
    pub fn as_str(self) -> &'static str {
        match self {
            Method::Get => "GET",
            Method::Post => "POST",
            Method::Patch => "PATCH",
        }
    }
}

/// One request. The key travels apart from the headers so a sender can keep it off a command line.
#[derive(Debug, Clone)]
pub struct Request {
    pub method: Method,
    pub url: String,
    /// A JSON body, when the call has one.
    pub body: Option<String>,
    /// The name of the header that carries the key (`X-API-Key`, `Authorization`).
    pub key_header: &'static str,
    pub key: Secret,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Response {
    pub status: u16,
    pub body: String,
}

/// Why a request got no response. Each is one fixed line; curl's own words are never kept.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HttpError {
    /// The system has no `curl` to send with.
    NoCurl,
    /// The request could not be made as written (a control character in it).
    BadRequest,
    /// The answer was longer than `MAX_ANSWER_BYTES`.
    TooLarge,
    /// No answer: the server is down, unknown, too slow, or its secure connection was refused.
    Unreachable(&'static str),
}

impl fmt::Display for HttpError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            HttpError::NoCurl => "curl is not installed",
            HttpError::BadRequest => "The request could not be made",
            HttpError::TooLarge => "The answer is larger than can be read",
            HttpError::Unreachable(line) => line,
        })
    }
}

/// The most of an answer that is read, in bytes.
pub const MAX_ANSWER_BYTES: usize = 4 * 1024 * 1024;

/// Something that sends a request and returns what came back. A failure to get any answer is an
/// `HttpError`; an answer with an error status is still a `Response`.
pub trait Http: Send + Sync {
    fn send(&self, request: &Request) -> Result<Response, HttpError>;
}

/// Whether `base` is an address a key may be sent to: `https` anywhere, or `http` only to a
/// machine on the user's own network (loopback, a private or link-local address, or a name with no
/// dots or ending `.local` / `.lan`). A key must not cross the internet in clear. The refusal is a
/// fixed line.
pub fn check_base_url(base: &str) -> Result<(), &'static str> {
    if base.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return Err("The address has a space or control character");
    }
    let (secure, rest) = if let Some(rest) = base.strip_prefix("https://") {
        (true, rest)
    } else if let Some(rest) = base.strip_prefix("http://") {
        (false, rest)
    } else {
        return Err("The address must start with http:// or https://");
    };
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    if authority.is_empty() || authority.contains('@') {
        return Err("The address must be a host, with no user name or password");
    }
    if secure {
        return Ok(());
    }
    let host = match authority.strip_prefix('[') {
        Some(v6) => v6.split(']').next().unwrap_or(""),
        None => authority.rsplit_once(':').map_or(authority, |(host, _)| host),
    };
    if is_private_host(host) {
        Ok(())
    } else {
        Err("The address uses http outside your own network; use https")
    }
}

fn is_private_host(host: &str) -> bool {
    use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
    if let Ok(ip) = host.parse::<IpAddr>() {
        return match ip {
            IpAddr::V4(v4) => v4.is_loopback() || v4.is_private() || v4.is_link_local() || v4 == Ipv4Addr::UNSPECIFIED,
            IpAddr::V6(v6) => {
                v6.is_loopback() || v6 == Ipv6Addr::UNSPECIFIED || (v6.segments()[0] & 0xfe00) == 0xfc00 || (v6.segments()[0] & 0xffc0) == 0xfe80
            }
        };
    }
    let host = host.to_ascii_lowercase();
    host == "localhost" || !host.contains('.') || host.ends_with(".local") || host.ends_with(".lan")
}

/// A pretend server for the tests of whatever sends requests: answers are scripted by a piece of
/// the address and body (the longest match wins; a piece ending in `$` must end the address), and every request is kept to be looked at.
#[cfg(test)]
pub mod fake {
    use super::*;
    use std::collections::VecDeque;
    use std::sync::Mutex;

    type Route = (String, VecDeque<Result<Response, HttpError>>);

    #[derive(Default)]
    pub struct FakeHttp {
        routes: Mutex<Vec<Route>>,
        seen: Mutex<Vec<Request>>,
    }

    impl FakeHttp {
        pub fn new() -> FakeHttp {
            FakeHttp::default()
        }

        /// Answer a request whose address or body contains `piece` with `status` and `body`. The
        /// longest piece that matches answers; a route with several answers gives them in order and
        /// repeats the last.
        pub fn on(self, piece: &str, status: u16, body: &str) -> FakeHttp {
            self.route(piece, Ok(Response { status, body: body.into() }))
        }

        pub fn fail(self, piece: &str, error: HttpError) -> FakeHttp {
            self.route(piece, Err(error))
        }

        fn route(self, piece: &str, answer: Result<Response, HttpError>) -> FakeHttp {
            let mut routes = self.routes.lock().unwrap();
            match routes.iter_mut().find(|(known, _)| known == piece) {
                Some((_, answers)) => answers.push_back(answer),
                None => routes.push((piece.into(), VecDeque::from([answer]))),
            }
            drop(routes);
            self
        }

        /// Every request sent so far, oldest first.
        pub fn seen(&self) -> Vec<Request> {
            self.seen.lock().unwrap().clone()
        }
    }

    impl Http for FakeHttp {
        fn send(&self, request: &Request) -> Result<Response, HttpError> {
            self.seen.lock().unwrap().push(request.clone());
            let haystack = format!("{}\n{}", request.url, request.body.as_deref().unwrap_or_default());
            let mut routes = self.routes.lock().unwrap();
            // The most specific piece that matches answers, so a route for a folder does not hide one
            // for something inside it.
            let Some((_, answers)) = routes.iter_mut().filter(|(piece, _)| match piece.strip_suffix('$') {
                    Some(end) => request.url.ends_with(end),
                    None => haystack.contains(piece.as_str()),
                }).max_by_key(|(piece, _)| piece.len()) else {
                return Err(HttpError::Unreachable("no route in the fake"));
            };
            if answers.len() > 1 { answers.pop_front().unwrap() } else { answers.front().cloned().unwrap() }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::fake::FakeHttp;
    use super::*;

    #[test]
    fn a_secret_never_shows_in_debug_output() {
        let request = Request { method: Method::Get, url: "https://x.example/api".into(), body: None, key_header: "X-API-Key", key: Secret::new("hunter2-token") };
        let shown = format!("{request:?} {:?}", request.key);
        assert!(!shown.contains("hunter2"), "{shown}");
        assert_eq!(request.key.expose(), "hunter2-token");
    }

    #[test]
    fn https_goes_anywhere_and_http_only_to_your_own_network() {
        for ok in [
            "https://plane.example.com",
            "https://plane.example.com/",
            "http://192.168.1.244",
            "http://192.168.1.244:8080/api",
            "http://10.0.0.5",
            "http://127.0.0.1:3000",
            "http://localhost",
            "http://[::1]:8080",
            "http://plane",
            "http://plane.local",
            "http://nas.lan:8000",
        ] {
            assert_eq!(check_base_url(ok), Ok(()), "{ok}");
        }
        for bad in [
            "http://plane.example.com",
            "http://8.8.8.8",
            "http://203.0.113.7",
            "ftp://plane",
            "plane.example.com",
            "https://user:pass@plane.example.com",
            "https://",
            "https://plane example.com",
            "http://192.168.1.1\n",
            "file:///etc/passwd",
        ] {
            assert!(check_base_url(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn the_fake_answers_by_a_piece_of_the_address_or_body_and_keeps_what_it_saw() {
        let fake = FakeHttp::new().on("/a", 200, "one").on("/a", 429, "two").on("needle", 201, "three");
        let ask = |url: &str, body: Option<&str>| {
            fake.send(&Request { method: Method::Post, url: url.into(), body: body.map(Into::into), key_header: "H", key: Secret::new("k") })
        };
        assert_eq!(ask("https://x/a", None).unwrap().body, "one");
        assert_eq!(ask("https://x/a", None).unwrap().status, 429);
        assert_eq!(ask("https://x/a", None).unwrap().status, 429);
        assert_eq!(ask("https://x/b", Some("a needle")).unwrap().status, 201);
        assert!(ask("https://x/c", None).is_err());
        assert_eq!(fake.seen().len(), 5);
    }
}
