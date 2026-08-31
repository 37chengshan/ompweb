# Output for Machines

Detect whether output is a terminal, emit JSON (line-delimited) for downstream tools, and read from stdin when input is piped.

## Signature / Usage

```rust
// Detect terminal vs pipe (std::io::IsTerminal, stable since Rust 1.70)
use std::io::IsTerminal;
if std::io::stdout().is_terminal() {
    println!("pretty human output");
} else {
    println!(r#"{{"key":"machine output"}}"#);
}

// JSON output with serde_json
use serde_json::json;
println!("{}", json!({"type": "message", "content": "Hello world"}));

// Read from file or stdin ("-" convention)
use std::io::{self, BufRead};
let stdin = io::stdin();
for line in stdin.lock().lines() {
    let line = line?;
    // process line
}
```

## Options / Props

| Crate | Purpose | Cargo.toml |
|-------|---------|------------|
| `serde` | Serialization framework | `serde = { version = "1", features = ["derive"] }` |
| `serde_json` | JSON serialization / `json!` macro | `serde_json = "1"` |

## Notes

- Prefer **line-delimited JSON** (one JSON document per line) so consumers can process messages as they stream in; use `println!` for each document.
- Use `std::io::IsTerminal` (stable) rather than the older `atty` crate which is unmaintained.
- When your tool accepts both a file path and piped stdin, the conventional flag is `-` to signal "read from stdin".
- `serde_json::json!` macro is handy for ad-hoc output; for typed output derive `serde::Serialize` on your structs and use `serde_json::to_string`.
- TSV (tab-separated values) is a simpler alternative when output is homogeneous rows.
- ripgrep's `--json` flag (line-delimited JSON with a `type` field per message) is a good real-world model to follow.

## Related

- [human-communication.md](./human-communication.md)
- [in-depth-human-communication.md](./in-depth-human-communication.md)
