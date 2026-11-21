//! JSON-RPC 2.0 lines, read strictly: a line that is not exactly a request, a notification or a
//! response is refused, never guessed at.

use anyhow::{Context, Result, bail, ensure};
use maitty_shared::conversation::ProviderRequestId;
use serde::Serialize;
use serde_json::{Value, json};

/// JSON-RPC's code for a method the receiver does not offer.
pub(crate) const METHOD_NOT_FOUND: i64 = -32601;

#[derive(Debug, PartialEq)]
pub(crate) enum Incoming {
    /// The agent asks something and waits for an answer under `id`.
    Request {
        id: ProviderRequestId,
        method: String,
        params: Value,
    },
    Notification {
        method: String,
        params: Value,
    },
    /// The agent's answer to request `id` of ours: its result, or its error code and message.
    Response {
        id: i64,
        result: std::result::Result<Value, (i64, String)>,
    },
}

pub(crate) fn decode(line: &str) -> Result<Incoming> {
    // The parser's error can quote the line, so it is not kept.
    let value: Value = serde_json::from_str(line).ok().context("Agent line is not JSON")?;
    let Value::Object(mut frame) = value else {
        bail!("Agent line is not a JSON object");
    };
    ensure!(frame.get("jsonrpc").and_then(Value::as_str) == Some("2.0"), "Agent line is not JSON-RPC 2.0");
    let id = frame.remove("id");
    let method = frame.remove("method");
    let (result, error) = (frame.remove("result"), frame.remove("error"));
    match (method, id, result, error) {
        (Some(Value::String(method)), id, None, None) => {
            let params = frame.remove("params").unwrap_or(Value::Null);
            match id {
                None => Ok(Incoming::Notification { method, params }),
                Some(id) => Ok(Incoming::Request { id: request_id(id)?, method, params }),
            }
        }
        (None, Some(id), Some(result), None) => Ok(Incoming::Response { id: own_id(&id)?, result: Ok(result) }),
        (None, Some(id), None, Some(error)) => {
            let code = error.get("code").and_then(Value::as_i64).context("Agent error has no code")?;
            let message = error.get("message").and_then(Value::as_str).unwrap_or_default().to_owned();
            Ok(Incoming::Response { id: own_id(&id)?, result: Err((code, message)) })
        }
        _ => bail!("Agent line is neither a request, a notification nor a response"),
    }
}

/// An id the agent chose. An integer and a string of its digits are different ids.
fn request_id(id: Value) -> Result<ProviderRequestId> {
    match id {
        Value::String(text) => Ok(ProviderRequestId::Text(text)),
        Value::Number(number) => number.as_i64().map(ProviderRequestId::Integer).context("Agent request id is not an integer"),
        _ => bail!("Agent request id is neither an integer nor a string"),
    }
}

/// An id of ours, which is always an integer.
fn own_id(id: &Value) -> Result<i64> {
    id.as_i64().context("Agent answered a request that was never sent")
}

pub(crate) fn request(id: i64, method: &str, params: &impl Serialize) -> Result<String> {
    line(json!({"jsonrpc": "2.0", "id": id, "method": method, "params": serde_json::to_value(params)?}))
}

pub(crate) fn notification(method: &str, params: &impl Serialize) -> Result<String> {
    line(json!({"jsonrpc": "2.0", "method": method, "params": serde_json::to_value(params)?}))
}

pub(crate) fn response(id: &ProviderRequestId, result: &impl Serialize) -> Result<String> {
    line(json!({"jsonrpc": "2.0", "id": id, "result": serde_json::to_value(result)?}))
}

pub(crate) fn error(id: &ProviderRequestId, code: i64, message: &str) -> Result<String> {
    line(json!({"jsonrpc": "2.0", "id": id, "error": {"code": code, "message": message}}))
}

fn line(frame: Value) -> Result<String> {
    let line = frame.to_string();
    ensure!(line.len() <= crate::MAX_FRAME_BYTES, "Line for the agent is too large");
    Ok(line)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_request_a_notification_and_both_responses_are_told_apart() {
        let request = decode(r#"{"jsonrpc":"2.0","id":"a1","method":"session/request_permission","params":{"x":1}}"#).unwrap();
        let notification = decode(r#"{"jsonrpc":"2.0","method":"session/update","params":{}}"#).unwrap();
        let result = decode(r#"{"jsonrpc":"2.0","id":3,"result":null}"#).unwrap();
        let error = decode(r#"{"jsonrpc":"2.0","id":4,"error":{"code":-32000,"message":"no"}}"#).unwrap();

        assert_eq!(request, Incoming::Request { id: ProviderRequestId::Text("a1".into()), method: "session/request_permission".into(), params: json!({"x": 1}) });
        assert_eq!(notification, Incoming::Notification { method: "session/update".into(), params: json!({}) });
        assert_eq!(result, Incoming::Response { id: 3, result: Ok(Value::Null) });
        assert_eq!(error, Incoming::Response { id: 4, result: Err((-32000, "no".into())) });
    }

    #[test]
    fn a_line_that_is_not_exactly_one_kind_of_message_is_refused() {
        for line in [
            "not json",
            "[1]",
            r#"{"id":1,"result":{}}"#,
            r#"{"jsonrpc":"1.0","id":1,"result":{}}"#,
            r#"{"jsonrpc":"2.0","id":1,"result":{},"error":{"code":1,"message":""}}"#,
            r#"{"jsonrpc":"2.0","id":1,"method":"x","result":{}}"#,
            r#"{"jsonrpc":"2.0","id":null,"method":"x"}"#,
            r#"{"jsonrpc":"2.0","id":"1","result":{}}"#,
            r#"{"jsonrpc":"2.0","id":1}"#,
            r#"{"jsonrpc":"2.0","id":1,"error":{"message":"no code"}}"#,
        ] {
            assert!(decode(line).is_err(), "{line}");
        }
    }

    #[test]
    fn an_error_never_quotes_the_line_it_refused() {
        let refused = decode(r#"{"jsonrpc":"2.0","token":"sk-secret""#).unwrap_err();

        assert!(!format!("{refused:#}").contains("sk-secret"));
    }

    #[test]
    fn what_is_written_is_one_line_of_json_rpc() {
        let asked = request(7, "session/prompt", &json!({"a": "two\nlines"})).unwrap();
        let told = notification("session/cancel", &json!({})).unwrap();
        let refused = error(&ProviderRequestId::Integer(2), METHOD_NOT_FOUND, "Method not found").unwrap();

        assert!(!asked.contains('\n'));
        assert_eq!(serde_json::from_str::<Value>(&asked).unwrap()["id"], 7);
        assert!(serde_json::from_str::<Value>(&told).unwrap().get("id").is_none());
        assert_eq!(serde_json::from_str::<Value>(&refused).unwrap()["error"]["code"], METHOD_NOT_FOUND);
    }
}
