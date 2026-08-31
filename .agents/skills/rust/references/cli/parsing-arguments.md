# Parsing Command-Line Arguments

Parse CLI arguments into a typed struct using `clap` with the derive feature. Raw access via `std::env::args()` is also available but rarely preferable.

## Signature / Usage

```toml
# Cargo.toml
[dependencies]
clap = { version = "4.0", features = ["derive"] }
```

```rust
use clap::Parser;

/// Search for a pattern in a file and display the matching lines.
#[derive(Parser)]
struct Cli {
    /// The pattern to look for
    pattern: String,
    /// The path to the file to read
    path: std::path::PathBuf,
}

fn main() {
    let args = Cli::parse();
    println!("pattern: {:?}, path: {:?}", args.pattern, args.path);
}
```

## Options / Props

| Attribute | Example | Description |
|-----------|---------|-------------|
| `#[arg(short = 'o', long = "output")]` | field attribute | Map a field to short/long flags |
| `#[derive(Parser)]` | struct attribute | Enable clap derive parsing on the struct |

## Notes

- `Cli::parse()` is intended for use inside `main`. It prints an error/help message and exits on failure — do not call it elsewhere.
- `--help` and `--version` are generated automatically.
- For short/long flags use `#[arg(short, long)]` on fields; for positional arguments just declare fields without the attribute.
- `clap` also supports sub-commands, shell completions (`clap_complete`), and custom validation.
- Low-level alternative: `std::env::args()` returns an iterator of raw `String`s (index 0 is the binary name).

## Related

- [human-communication.md](./human-communication.md)
- [project-setup.md](./project-setup.md)
