//! Sending a request with the system's `curl`, so the daemon needs no HTTP library of its own (and
//! no extra supply-chain surface): Windows has had `curl.exe` since 10, and macOS and Linux ship
//! it. The request, including the key, goes to curl on its standard input as a config, never on
//! the command line where `ps` would show it. Redirects are not followed, so a key is never
//! forwarded to another address. curl's own messages are not kept: a failure is one of a few fixed
//! lines (`HttpError`).

use crate::http::{Http, HttpError, MAX_ANSWER_BYTES, Request, Response};
use std::io::{Read, Write};
use std::process::Stdio;

/// How long a request may take in all, in seconds.
const TIMEOUT_SECS: u64 = 20;
/// curl's exit code for "the answer was bigger than --max-filesize".
const CURL_TOO_BIG: i32 = 63;
/// What follows the answer: a newline and a three-digit status, with room to spare.
const STATUS_ROOM: usize = 16;

#[derive(Debug, Default, Clone, Copy)]
pub struct CurlHttp;

/// The arguments curl is started with: only ones that name no secret. Everything about the request
/// is in `config_for`. `--disable` comes first so a `.curlrc` of the user's cannot change it.
fn argv() -> [&'static str; 3] {
    ["--disable", "--config", "-"]
}

/// A curl config string for `text`: quoted, with the characters curl reads specially escaped.
/// Refuses anything it cannot represent faithfully.
fn quote(text: &str) -> Result<String, HttpError> {
    let mut out = String::from("\"");
    for c in text.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if c.is_control() => return Err(HttpError::BadRequest),
            c => out.push(c),
        }
    }
    out.push('"');
    Ok(out)
}

/// The curl config for one request, to be written to its standard input.
fn config_for(request: &Request) -> Result<String, HttpError> {
    // A header name is a program's constant; one with a colon or a space in it would be a bug.
    if request.key_header.is_empty() || !request.key_header.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err(HttpError::BadRequest);
    }
    let mut config = String::new();
    let mut line = |key: &str, value: String| {
        config.push_str(key);
        config.push_str(" = ");
        config.push_str(&value);
        config.push('\n');
    };
    line("url", quote(&request.url)?);
    line("request", quote(request.method.as_str())?);
    line("header", quote(&format!("{}: {}", request.key_header, request.key.expose()))?);
    line("header", quote("Accept: application/json")?);
    if let Some(body) = &request.body {
        line("header", quote("Content-Type: application/json")?);
        line("data-binary", quote(body)?);
    }
    // An address that is not `http` or `https` is never spoken to; `https` is not downgraded.
    line("proto", quote(if request.url.starts_with("https://") { "=https" } else { "=http,https" })?);
    line("max-time", TIMEOUT_SECS.to_string());
    line("max-filesize", MAX_ANSWER_BYTES.to_string());
    // The status goes after the body, on its own line, so one call returns both.
    line("write-out", quote("\\n%{http_code}")?);
    config.push_str("silent\n");
    Ok(config)
}

/// The fixed line for a curl exit code that is not "worked".
fn why(code: Option<i32>) -> HttpError {
    match code {
        Some(CURL_TOO_BIG) => HttpError::TooLarge,
        Some(6 | 7) => HttpError::Unreachable("The server could not be reached"),
        Some(28) => HttpError::Unreachable("The server did not answer in time"),
        Some(35 | 51 | 58 | 59 | 60 | 77 | 83 | 90) => HttpError::Unreachable("The server's secure connection was refused"),
        _ => HttpError::Unreachable("The request could not be completed"),
    }
}

/// The body and status from curl's output: the status is the last line.
fn split_status(stdout: &[u8]) -> Result<Response, HttpError> {
    let text = String::from_utf8_lossy(stdout);
    let no_status = HttpError::Unreachable("The server gave no status");
    let (body, status) = text.rsplit_once('\n').ok_or(no_status)?;
    let status = status.trim().parse().map_err(|_| no_status)?;
    Ok(Response { status, body: body.to_owned() })
}

impl Http for CurlHttp {
    fn send(&self, request: &Request) -> Result<Response, HttpError> {
        let config = config_for(request)?;
        let mut command = crate::proc::system_tool("curl");
        command.args(argv()).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
        let mut child = crate::proc::quiet(&mut command).spawn().map_err(|error| match error.kind() {
            std::io::ErrorKind::NotFound => HttpError::NoCurl,
            _ => HttpError::Unreachable("curl could not be started"),
        })?;
        // A thread feeds the config so a full pipe cannot stall us; the child is waited for below.
        let mut stdin = child.stdin.take().ok_or(HttpError::Unreachable("curl could not be started"))?;
        let feeder = std::thread::spawn(move || stdin.write_all(config.as_bytes()));
        // Read no more than the cap and a status: curl's own limit only sees a length the server
        // announces, so a server that streams without one is stopped here.
        let mut answer = Vec::new();
        if let Some(stdout) = child.stdout.take() {
            // A read that fails is a curl that ended early; its exit code says why below.
            let _ = stdout.take((MAX_ANSWER_BYTES + STATUS_ROOM + 1) as u64).read_to_end(&mut answer);
        }
        if answer.len() > MAX_ANSWER_BYTES + STATUS_ROOM {
            // The child may have just ended by itself, which is what is wanted.
            let _ = child.kill();
            let _ = child.wait();
            let _ = feeder.join();
            return Err(HttpError::TooLarge);
        }
        let status = child.wait().map_err(|_| HttpError::Unreachable("curl could not be waited for"))?;
        // A feeder that failed means curl left before reading it all; its exit code says why.
        let _ = feeder.join();
        if !status.success() {
            return Err(why(status.code()));
        }
        split_status(&answer)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::http::{Method, Secret};
    use std::net::TcpListener;

    const KEY: &str = "lin_api_SECRETKEY-\"123\"\\";

    fn request(url: &str, method: Method, body: Option<&str>) -> Request {
        Request { method, url: url.into(), body: body.map(String::from), key_header: "Authorization", key: Secret::new(KEY) }
    }

    #[test]
    fn the_key_is_in_the_config_and_never_in_the_arguments() {
        assert!(argv().iter().all(|a| !a.contains("SECRET")));
        assert_eq!(argv()[0], "--disable");
        let config = config_for(&request("https://x.example/api", Method::Post, Some("{\"a\":\"b\\nc\"}"))).unwrap();
        assert!(config.contains(r#"header = "Authorization: lin_api_SECRETKEY-\"123\"\\""#), "{config}");
        assert!(config.contains(r#"data-binary = "{\"a\":\"b\\nc\"}""#), "{config}");
        assert!(config.contains("request = \"POST\""));
        assert!(config.contains("proto = \"=https\""));
        assert!(!config.contains("location"), "redirects are never followed");
        let local = config_for(&request("http://127.0.0.1:1/x", Method::Get, None)).unwrap();
        assert!(local.contains("proto = \"=http,https\""));
    }

    #[test]
    fn a_control_character_or_an_odd_header_name_cannot_be_smuggled_into_the_config() {
        let mut r = request("http://plane/x", Method::Get, None);
        r.url = "http://plane/x\nurl = \"http://evil\"".into();
        // A newline is escaped as text, never a new config line.
        assert!(!config_for(&r).unwrap().contains("\nurl = \"http://evil"));
        r.url = "http://plane/x\u{1b}".into();
        assert_eq!(config_for(&r).unwrap_err(), HttpError::BadRequest);
        let mut r = request("http://plane/x", Method::Get, None);
        r.key_header = "X-Key\nurl = x";
        assert_eq!(config_for(&r).unwrap_err(), HttpError::BadRequest);
    }

    #[test]
    fn the_status_is_the_last_line_of_the_output() {
        assert_eq!(split_status(b"{\"ok\":true}\n200").unwrap(), Response { status: 200, body: "{\"ok\":true}".into() });
        assert_eq!(split_status(b"\n404").unwrap().status, 404);
        assert!(split_status(b"").is_err() && split_status(b"no status").is_err());
    }

    #[test]
    fn a_failure_is_a_fixed_line_that_names_neither_the_key_nor_curl() {
        for code in [Some(6), Some(7), Some(28), Some(35), Some(60), Some(2), None] {
            let shown = format!("{} {:?}", why(code), why(code));
            assert!(!shown.contains("SECRET") && !shown.contains("curl"), "{shown}");
        }
        assert_eq!(why(Some(CURL_TOO_BIG)), HttpError::TooLarge);
    }

    /// Answer one connection with `reply`, returning what the client sent.
    fn serve_once(reply: Vec<u8>) -> (u16, std::thread::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let handle = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut seen = Vec::new();
            let mut buf = [0u8; 4096];
            // Read until the headers end, then any body Content-Length promised.
            loop {
                let n = stream.read(&mut buf).unwrap();
                seen.extend_from_slice(&buf[..n]);
                let text = String::from_utf8_lossy(&seen).to_string();
                if let Some(end) = text.find("\r\n\r\n") {
                    let want = text
                        .lines()
                        .find_map(|l| l.to_ascii_lowercase().strip_prefix("content-length: ").and_then(|v| v.trim().parse::<usize>().ok()))
                        .unwrap_or(0);
                    if seen.len() >= end + 4 + want {
                        break;
                    }
                }
                if n == 0 {
                    break;
                }
            }
            // A client that stops reading (the size cap) makes this fail, which is expected.
            let _ = stream.write_all(&reply);
            String::from_utf8_lossy(&seen).to_string()
        });
        (port, handle)
    }

    #[test]
    fn a_request_reaches_a_server_with_its_key_and_body_and_the_answer_comes_back() {
        if !crate::proc::on_path("curl") {
            return;
        }
        let (port, server) = serve_once(b"HTTP/1.1 201 Created\r\nContent-Length: 10\r\nConnection: close\r\n\r\n{\"id\":\"x\"}".to_vec());
        let r = request(&format!("http://127.0.0.1:{port}/api/v1/x"), Method::Post, Some("{\"name\":\"a b\"}"));
        assert_eq!(CurlHttp.send(&r).unwrap(), Response { status: 201, body: "{\"id\":\"x\"}".into() });
        let seen = server.join().unwrap();
        assert!(seen.starts_with("POST /api/v1/x HTTP/1.1"), "{seen}");
        assert!(seen.contains("Authorization: lin_api_SECRETKEY-\"123\"\\"), "{seen}");
        assert!(seen.ends_with("{\"name\":\"a b\"}"), "{seen}");
    }

    #[test]
    fn a_redirect_is_returned_and_not_followed() {
        if !crate::proc::on_path("curl") {
            return;
        }
        let (port, server) =
            serve_once(b"HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:1/elsewhere\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_vec());
        let response = CurlHttp.send(&request(&format!("http://127.0.0.1:{port}/x"), Method::Get, None)).unwrap();
        assert_eq!(response.status, 302);
        server.join().unwrap();
    }

    #[test]
    fn an_answer_over_the_cap_is_refused_whether_or_not_the_server_says_how_long_it_is() {
        if !crate::proc::on_path("curl") {
            return;
        }
        let too_long = MAX_ANSWER_BYTES + 1024;
        let mut announced = format!("HTTP/1.1 200 OK\r\nContent-Length: {too_long}\r\nConnection: close\r\n\r\n").into_bytes();
        announced.extend(std::iter::repeat_n(b'x', too_long));
        let (port, server) = serve_once(announced);
        let error = CurlHttp.send(&request(&format!("http://127.0.0.1:{port}/x"), Method::Get, None)).unwrap_err();
        assert_eq!(error, HttpError::TooLarge);
        server.join().unwrap();

        // No length given: only the reader's own cap can stop it.
        let mut streamed = b"HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n".to_vec();
        streamed.extend(std::iter::repeat_n(b'x', too_long));
        let (port, server) = serve_once(streamed);
        let error = CurlHttp.send(&request(&format!("http://127.0.0.1:{port}/x"), Method::Get, None)).unwrap_err();
        assert_eq!(error, HttpError::TooLarge);
        server.join().unwrap();
    }

    #[test]
    fn a_server_that_is_not_there_is_unreachable_with_a_fixed_line() {
        if !crate::proc::on_path("curl") {
            return;
        }
        let port = TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        let error = CurlHttp.send(&request(&format!("http://127.0.0.1:{port}/x"), Method::Get, None)).unwrap_err();
        assert!(matches!(error, HttpError::Unreachable(_)), "{error:?}");
        assert!(!format!("{error} {error:?}").contains("SECRET"));
    }

    #[test]
    fn only_http_and_https_are_spoken() {
        if !crate::proc::on_path("curl") {
            return;
        }
        let error = CurlHttp.send(&request("file:///etc/passwd", Method::Get, None)).unwrap_err();
        assert!(matches!(error, HttpError::Unreachable(_)), "{error:?}");
    }
}
