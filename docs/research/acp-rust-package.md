# Which Rust package for ACP?

Checked 2026-11-20 on Linux with cargo 1.100.0, in a scratch workspace outside the repo. Nothing
was added to this repository's `Cargo.toml` or `Cargo.lock`.

## Recommendation

Use the types crate only, pinned exactly and without its default feature:

```toml
agent-client-protocol-schema = { version = "=1.20.0", default-features = false }
```

Write the JSON-RPC line handling ourselves in `maitty-provider-acp`, on the process transport
core already has. Do not take the SDK crate `agent-client-protocol`.

## The two packages

| | `agent-client-protocol-schema` 1.20.0 | `agent-client-protocol` 5.4.0 (the SDK) |
| --- | --- | --- |
| What it is | Request, response and notification types, the JSON-RPC envelope, and routing by method name | Connections, request tracking, sessions, and a process launcher, on top of the schema crate |
| License | Apache-2.0 | Apache-2.0 |
| Minimum Rust | 1.88 | 1.88 |
| Build script | none | none |
| Async runtime | none | `futures` and `futures-concurrency`; the `process` feature adds `async-io`, `async-process` and `blocking` |
| Crates in its tree, itself included (normal edges) | 32, or 38 with the default `schemars` feature | 61, or 78 with `process` |
| Crate names not yet in our `Cargo.lock` | 2 (itself and `unicode-xid`) | 8 (itself, its derive crate, the schema crate, `futures`, `futures-concurrency`, `pin-project`, `pin-project-internal`, `unicode-xid`) |
| Major versions | 1.x since 2026-06-24 | 1, 2, 3 and 5 between 2026-06-24 and 2026-11-02 |
| Release pace | 70 versions; six in the last three weeks | 91 versions; five in the last three weeks |
| crates.io downloads | 7.2 million | 6.5 million |
| Owners | `benbrandt` and the `agentclientprotocol` rust-maintainers team | the same, plus `agu-z` |

`cargo check` passed for both on `x86_64-unknown-linux-gnu`, `x86_64-pc-windows-gnu` and
`aarch64-apple-darwin`. That is a type check for each target, not a build or a run on Windows or
macOS.

## Why the schema crate

- **It fits a dialect with no I/O.** A trial test built an `initialize` request line and read a
  `session/update` and a `session/request_permission` payload with
  `AgentNotification::from_method_and_params` and `AgentRequest::from_method_and_params`, with no
  runtime. An unknown method is an error, which is what the adapter wants.
- **It brings no second runtime.** The daemon runs on tokio. The SDK reads and writes through
  the `futures` I/O traits and its launcher uses `async-process`, so it would sit beside
  `OwnedChild` and the generation fence rather than under them.
- **Its version line is calmer.** The SDK had four major versions in five months; its 5.0.0 lists
  18 breaking changes. The schema crate has stayed on 1.x in that time.
- **It adds almost nothing.** Besides the crate itself, only `unicode-xid` is new to our lockfile
  by name.

## Costs and cautions

- We write the request-id bookkeeping and the envelope handling ourselves. The crate's own docs
  say its helpers "only select and deserialize payloads".
- Do not deserialize the routing enums straight from a wire payload. The crate's docs warn that
  they pick a variant by shape and can pick the wrong one. Route by method name.
- The schema crate releases every few days. Pin the exact version and update it deliberately, in
  its own commit ([SECURITY](../SECURITY.md#dependencies-and-supply-chain)).
- SDK 5.4.0 pins schema 1.19.0, one behind. The two cannot be assumed to move together.
- Protocol v2 types sit behind the `unstable_protocol_v2` feature. Leave it off.
- Lockfile matches above are by crate name. A version already in the lockfile may differ from
  the one this crate asks for.

## Not checked

- No build or run on a real Windows or macOS machine.
- No audit of the crate's source beyond its layout, its features and the absence of a build
  script.
- Whether Gemini CLI's ACP output parses with these types. That is the fixture from MAITTY-469.
