# Using Config Files

Persist user settings between invocations using the `confy` crate, which handles XDG/platform-appropriate config paths automatically.

## Signature / Usage

```toml
# Cargo.toml
[dependencies]
confy = "0.5"
serde = { version = "1", features = ["derive"] }
```

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
struct MyConfig {
    name: String,
    comfy: bool,
    foo: i64,
}

impl Default for MyConfig {
    fn default() -> Self {
        MyConfig { name: "default".into(), comfy: true, foo: 42 }
    }
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let cfg: MyConfig = confy::load("my_app", None)?;
    println!("{:#?}", cfg);
    Ok(())
}
```

## Notes

- `confy::load("app_name", None)` reads from a platform-appropriate path (e.g. `~/.config/my_app/default.toml` on Linux via XDG).
- The config struct must implement `Default` (used when no file exists), `Serialize`, and `Deserialize`.
- `confy` stores configs as TOML by default; it creates the file with default values on first run.
- For more complex needs (env vars, layered config, CLI override), consider the [`config`](https://docs.rs/config) crate.

## Related

- [parsing-arguments.md](./parsing-arguments.md)
- [in-depth-human-communication.md](./in-depth-human-communication.md)
