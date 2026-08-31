# Error Handling

Use `Result`, the `?` operator, and the `anyhow` crate to propagate and contextualize errors in CLI applications without panicking.

## Signature / Usage

```rust
// Idiomatic main with anyhow
use anyhow::{Context, Result};

fn main() -> Result<()> {
    let content = std::fs::read_to_string("test.txt")
        .with_context(|| "could not read file `test.txt`")?;
    println!("file content: {}", content);
    Ok(())
}
// Error output:
// Error: could not read file `test.txt`
// Caused by:
//     No such file or directory (os error 2)
```

## Options / Props

| Crate | Purpose | Cargo.toml |
|-------|---------|------------|
| `anyhow` | Easy `Box<dyn Error>` wrapper with context chaining | `anyhow = "1"` |
| `thiserror` | Derive-based custom error types | `thiserror = "1"` |

## Notes

- `?` on a `Result` propagates the error to the caller; the function must return `Result`.
- `.unwrap()` panics on `Err`; `.expect("msg")` panics with a custom message — both are fine for prototyping, but should be replaced before shipping.
- `Box<dyn std::error::Error>` as the `main` return type is sufficient for simple tools; `anyhow::Result` adds error context chaining.
- `anyhow::Context::with_context` attaches a lazily-evaluated message and preserves the original error as the "cause".
- For libraries, prefer `thiserror` so callers can match on specific error variants; `anyhow` is better suited for application (binary) error handling.

## Related

- [human-communication.md](./human-communication.md)
- [in-depth-exit-code.md](./in-depth-exit-code.md)
