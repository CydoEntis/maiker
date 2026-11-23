//! The JSON-RPC lines Codex's app-server exchanges, read strictly.

use anyhow::{Context, Result, bail};
use maitty_shared::conversation::ProviderRequestId;
use serde_json::Value;

#[derive(Clone, PartialEq, Eq, Hash, Debug, serde::Serialize, serde::Deserialize)]
#[serde(untagged)]
/// The identity of one request, as JSON-RPC allows it.
pub enum RequestId {
    Integer(i64),
    Text(String),
}

const THREAD_NOT_MATERIALIZED_MESSAGE: &str =
    "thread is not materialized yet; thread/turns/list is unavailable before first user message";

#[derive(Debug)]
/// An error answer. Its message is never kept: it can quote what the request held.
pub struct RpcError {
    pub code: i64,
    thread_not_materialized: bool,
}

impl RpcError {
    /// An error an adapter states itself, in place of one the provider sent.
    pub fn adapter_failure(code: i64) -> Self {
        Self {
            code,
            thread_not_materialized: false,
        }
    }

    /// Codex refused to list the turns of a thread that has had no message yet.
    pub fn is_thread_not_materialized(&self) -> bool {
        self.thread_not_materialized
    }
}

impl From<RequestId> for ProviderRequestId {
    fn from(id: RequestId) -> Self {
        match id {
            RequestId::Integer(value) => Self::Integer(value),
            RequestId::Text(value) => Self::Text(value),
        }
    }
}

impl From<ProviderRequestId> for RequestId {
    fn from(id: ProviderRequestId) -> Self {
        match id {
            ProviderRequestId::Integer(value) => Self::Integer(value),
            ProviderRequestId::Text(value) => Self::Text(value),
        }
    }
}

/// One line from Codex: an answer, something it reports, or something it asks.
pub enum Envelope {
    Response {
        id: RequestId,
        result: Result<Value, RpcError>,
    },
    Notification {
        method: String,
        params: Value,
    },
    Request {
        id: RequestId,
        method: String,
        params: Value,
    },
}

struct EnvelopeObject(serde_json::Map<String, Value>);

impl<'de> serde::Deserialize<'de> for EnvelopeObject {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct ObjectVisitor;
        impl<'de> serde::de::Visitor<'de> for ObjectVisitor {
            type Value = EnvelopeObject;
            fn expecting(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                f.write_str("an unambiguous provider envelope")
            }
            fn visit_map<M: serde::de::MapAccess<'de>>(
                self,
                mut fields: M,
            ) -> Result<Self::Value, M::Error> {
                let mut object = serde_json::Map::new();
                while let Some((key, value)) = fields.next_entry::<String, Value>()? {
                    if object.insert(key, value).is_some() {
                        return Err(serde::de::Error::custom("duplicate envelope field"));
                    }
                }
                Ok(EnvelopeObject(object))
            }
        }
        deserializer.deserialize_map(ObjectVisitor)
    }
}

/// Reads one line strictly: a frame that could be read two ways is refused.
pub fn decode(line: &str) -> Result<Envelope> {
    // Parse errors deliberately omit source text and serde's input-derived details.
    let EnvelopeObject(object) =
        serde_json::from_str(line).map_err(|_| anyhow::anyhow!("Malformed Codex JSON frame"))?;
    if object.get("jsonrpc").is_some_and(|v| v != "2.0") {
        bail!("Invalid Codex JSON-RPC version");
    }
    let id = object
        .get("id")
        .map(|value| {
            value
                .as_i64()
                .map(RequestId::Integer)
                .or_else(|| value.as_str().map(|s| RequestId::Text(s.into())))
                .context("Codex request ID must be an integer or string")
        })
        .transpose()?;
    let method = object
        .get("method")
        .map(|m| {
            m.as_str()
                .filter(|s| !s.is_empty() && !s.chars().any(char::is_control))
                .map(str::to_owned)
                .context("Invalid Codex method")
        })
        .transpose()?;
    if let Some(method) = method {
        if object.keys().any(|k| {
            !["jsonrpc", "id", "method", "params"].contains(&k.as_str())
                && !(k == "emittedAtMs" && id.is_none())
        }) {
            let keys: Vec<_> = object
                .keys()
                .take(8)
                .map(|key| {
                    key.chars()
                        .filter(|ch| ch.is_ascii_alphanumeric() || *ch == '_')
                        .take(48)
                        .collect::<String>()
                })
                .collect();
            bail!(
                "Ambiguous Codex request envelope (fields: {})",
                keys.join(", ")
            );
        }
        if object
            .get("emittedAtMs")
            .is_some_and(|value| !value.is_null() && value.as_i64().is_none())
        {
            bail!("Invalid Codex notification timestamp");
        }
        let params = object.get("params").cloned().unwrap_or(Value::Null);
        if !params.is_null() && !params.is_object() && !params.is_array() {
            bail!("Invalid Codex params");
        }
        return Ok(match id {
            Some(id) => Envelope::Request { id, method, params },
            None => Envelope::Notification { method, params },
        });
    }
    let id = id.context("Codex response has no request ID")?;
    if object
        .keys()
        .any(|k| !["jsonrpc", "id", "result", "error"].contains(&k.as_str()))
        || object.contains_key("result") == object.contains_key("error")
    {
        bail!("Ambiguous Codex response envelope");
    }
    let result = if let Some(result) = object.get("result") {
        Ok(result.clone())
    } else {
        let error = object["error"]
            .as_object()
            .context("Invalid Codex error response")?;
        if !error.get("code").is_some_and(|c| c.as_i64().is_some())
            || !error.get("message").is_some_and(Value::is_string)
            || error
                .keys()
                .any(|k| !["code", "message", "data"].contains(&k.as_str()))
        {
            bail!("Invalid Codex error response");
        }
        let message = error["message"]
            .as_str()
            .context("Invalid Codex error message")?;
        Err(RpcError {
            code: error["code"].as_i64().context("Invalid Codex error code")?,
            thread_not_materialized: message == THREAD_NOT_MATERIALIZED_MESSAGE,
        })
    };
    Ok(Envelope::Response { id, result })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identifies_only_codexs_unmaterialized_thread_error() {
        let response = decode(&format!(
            r#"{{"id":2,"error":{{"code":-32600,"message":"{THREAD_NOT_MATERIALIZED_MESSAGE}"}}}}"#
        ))
        .unwrap();
        assert!(matches!(
            response,
            Envelope::Response {
                result: Err(error),
                ..
            } if error.code == -32600 && error.is_thread_not_materialized()
        ));

        let response =
            decode(r#"{"id":2,"error":{"code":-32600,"message":"invalid request"}}"#).unwrap();
        assert!(matches!(
            response,
            Envelope::Response {
                result: Err(error),
                ..
            } if error.code == -32600 && !error.is_thread_not_materialized()
        ));
    }
}
