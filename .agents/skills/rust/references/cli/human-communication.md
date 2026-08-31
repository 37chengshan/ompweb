# Output for Humans

Print to stdout/stderr, show progress bars, and emit structured log messages from a CLI application.

## Signature / Usage

```rust
// Basic stdout / stderr
println!("This is information");
eprintln!("This is an error :(");

// Debug representation
let xs = vec![1, 2, 3];
println!("The list is: {:?}", xs);

// Buffered stdout for high-throughput output
use std::io::{self, Write};
let stdout = io::stdout();
let mut handle = io::BufWriter::new(stdout);
writeln!(handle, "foo: {}", 42)?;

// Progress bar (indicatif crate)
use indicatif::ProgressBar;
let bar = ProgressBar::new(100);
bar.inc(1);
bar.finish();

// Logging (log + env_logger crates)
use log::{info, warn};
env_logger::init();
info!("starting up");
warn!("oops, nothing implemented!");
```

## Options / Props

| Crate | Purpose | Cargo.toml |
|-------|---------|------------|
| `indicatif` | Progress bars and spinners | `indicatif = "0.17"` |
| `log` | Logging facade (macros: `error!`, `warn!`, `info!`, `debug!`, `trace!`) | `log = "0.4"` |
| `env_logger` | Log adapter that reads `RUST_LOG` env var | `env_logger = "0.10"` |
| `clap-verbosity-flag` | Adds `--verbose` flag to clap apps | `clap-verbosity-flag = "2"` |
| `human-panic` | User-friendly panic messages | `human-panic = "1"` |

## Notes

- Use `println!` for stdout and `eprintln!` for stderr so that errors can be separated from normal output when piping.
- `println!` flushes on every call; wrap `stdout` in `BufWriter` and lock it when printing in tight loops.
- `RUST_LOG=info cargo run` enables log output from `env_logger`; supports per-module filters like `RUST_LOG=my_crate=debug`.
- Log levels ordered by severity (highest first): `error` > `warn` > `info` > `debug` > `trace`.
- Add `#[derive(Debug)]` to custom types to enable `{:?}` formatting.
- Avoid printing raw ANSI escape codes; use a crate like `ansi_term` or `colored` instead.

## Related

- [machine-communication.md](./machine-communication.md)
- [in-depth-human-communication.md](./in-depth-human-communication.md)
- [parsing-arguments.md](./parsing-arguments.md)
