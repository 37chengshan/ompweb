# In-Depth: Exit Codes

Emit meaningful exit codes so shell scripts and CI pipelines can detect success or failure programmatically.

## Signature / Usage

```toml
# Cargo.toml
[dependencies]
exitcode = "1"
```

```rust
fn main() {
    // ... actual work ...
    match result {
        Ok(_) => {
            println!("Done!");
            std::process::exit(exitcode::OK);
        }
        Err(CustomError::CantReadConfig(e)) => {
            eprintln!("Error: {}", e);
            std::process::exit(exitcode::CONFIG);
        }
        Err(e) => {
            eprintln!("Error: {}", e);
            std::process::exit(exitcode::DATAERR);
        }
    }
}
```

## Options / Props

| Code constant | Value | Meaning |
|---------------|-------|---------|
| `exitcode::OK` | 0 | Success |
| `exitcode::USAGE` | 64 | Command-line usage error |
| `exitcode::DATAERR` | 65 | Input data error |
| `exitcode::NOINPUT` | 66 | Cannot open input |
| `exitcode::CONFIG` | 78 | Configuration error |
| `exitcode::UNAVAILABLE` | 69 | Service unavailable |

*(Full list in the [`exitcode` docs](https://docs.rs/exitcode))*

## Notes

- Exit code `0` means success; any non-zero value signals failure.
- Rust panics exit with code `101` by default.
- Many tools use `1` for generic failures; prefer the BSD `sysexits.h` constants (via the `exitcode` crate) for richer semantics.
- `std::process::exit(code)` terminates immediately without running destructors — call it only after all cleanup is complete.
- Alternatively, returning `Result` from `main` will exit with `1` on `Err`; combine with `anyhow` for readable error messages without explicit `exit` calls.

## Related

- [in-depth-signal-handling.md](./in-depth-signal-handling.md)
- [human-communication.md](./human-communication.md)
