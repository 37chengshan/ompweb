# Cargo Guide

A practical guide to using Cargo for everyday Rust development.

## Why Cargo Exists

Without Cargo, building non-trivial Rust programs means invoking `rustc` manually with explicit flags, and managing transitive dependencies by hand. Cargo solves this by:

1. Introducing metadata files (`Cargo.toml`) to declare package info and dependencies
2. Fetching and building dependencies automatically from a registry
3. Invoking the compiler with correct parameters
4. Establishing conventions so any Cargo project can be built the same way

## Creating a New Package

```bash
cargo new hello_world --bin   # binary (executable)
cargo new my_lib --lib        # library
```

Options:
- `--vcs none` — skip git initialization (git is created by default)

## Package Layout

Cargo follows these directory conventions:

```
.
├── Cargo.lock
├── Cargo.toml
├── src/
│   ├── lib.rs          # default library target
│   ├── main.rs         # default binary target
│   └── bin/
│       └── extra.rs    # additional binaries
├── examples/
│   └── demo.rs
├── tests/
│   └── integration.rs  # integration tests
└── benches/
    └── bench.rs
```

| Location | Purpose |
|----------|---------|
| `src/main.rs` | Default binary |
| `src/lib.rs` | Default library |
| `src/bin/*.rs` | Additional binaries |
| `examples/` | Example programs |
| `tests/` | Integration tests |
| `benches/` | Benchmarks |

## Adding Dependencies

Edit `Cargo.toml`:

```toml
[dependencies]
regex = "0.1.41"
time = "0.1.12"
```

Or use `cargo add`:

```bash
cargo add serde --features derive
```

After adding, `cargo build` fetches and compiles dependencies automatically.

## Cargo.toml vs Cargo.lock

| Aspect | Cargo.toml | Cargo.lock |
|--------|-----------|-----------|
| Written by | Developer | Cargo (auto-generated) |
| Purpose | Declare dependencies (ranges) | Lock exact versions used |
| Commit to VCS | Always | Yes for binaries; optional for libraries |
| Edit manually | Yes | No |

The lock file ensures reproducible builds. Update it with:

```bash
cargo update          # update all dependencies
cargo update regex    # update just "regex"
```

## Running Tests

```bash
cargo test            # run all tests
cargo test foo        # run tests matching "foo"
```

Tests are discovered from:
- `src/` files (unit tests and doc tests)
- `tests/` directory (integration tests)

## Continuous Integration

Minimal CI configuration (GitHub Actions):

```yaml
- uses: dtolnay/rust-toolchain@stable
- run: cargo test
```

For verifying newest dependencies:

```bash
cargo update && cargo test
```

## Working on an Existing Package

```bash
git clone <url>
cd <project>
cargo build   # Cargo.lock ensures reproducible build
```

## Cargo Home

Cargo stores downloaded data in `$CARGO_HOME` (default: `~/.cargo/`):

| Path | Content |
|------|---------|
| `~/.cargo/bin/` | Installed binaries |
| `~/.cargo/registry/` | Registry index and crate sources |
| `~/.cargo/git/` | Git-based dependency sources |

## Optimizing Build Performance

- Use `cargo check` instead of `cargo build` when only checking for errors
- Enable the `sccache` compiler cache via `RUSTC_WRAPPER=sccache`
- Use `[profile.dev.package."*"]` to optimize specific slow dependencies
- Reduce `codegen-units` in `[profile.release]` for smaller binaries at cost of build time

## Related

- [getting-started.md](./getting-started.md)
- [reference-manifest.md](./reference-manifest.md)
- [reference-specifying-dependencies.md](./reference-specifying-dependencies.md)
- [reference-cargo-toml.md](./reference-cargo-toml.md)
- [reference-profiles.md](./reference-profiles.md)
