# Cargo

Cargo is Rust's official package manager and build tool. It manages dependencies from [crates.io](https://crates.io), runs tests, benchmarks, and build scripts.

## Common Commands

```bash
cargo new my_project       # create a new binary project
cargo new --lib my_lib     # create a library project
cargo build                # compile (debug)
cargo build --release      # compile with optimizations
cargo run                  # build and run
cargo test                 # run tests
cargo doc --open           # build and open documentation
cargo clean                # remove build artifacts
```

## Cargo.toml — Project Manifest

```toml
[package]
name    = "my_project"
version = "0.1.0"
edition = "2021"

[dependencies]
serde = { version = "1", features = ["derive"] }
rand  = "0.8"

[dev-dependencies]
# dependencies only for tests / examples
pretty_assertions = "1"

[build-dependencies]
# dependencies for build scripts
cc = "1"
```

## Conventions

```
my_project/
  Cargo.toml
  Cargo.lock       # exact dependency versions (commit for binaries)
  src/
    main.rs        # binary entry point
    lib.rs         # library entry point (optional)
  tests/           # integration tests
  examples/        # runnable examples (cargo run --example name)
  benches/         # benchmarks
  build.rs         # build script (optional)
```

## Build Scripts

`build.rs` runs before compilation — useful for code generation or linking native libraries:

```rust
// build.rs
fn main() {
    println!("cargo:rustc-link-lib=ssl");
}
```

## Notes

- `Cargo.lock` should be committed for binaries; libraries typically exclude it from VCS.
- Feature flags: `cargo build --features "feat1 feat2"`.
- Workspace: group multiple packages under one `[workspace]` in a root `Cargo.toml`.

## Related

- [11-crates.md](./11-crates.md)
- [21-testing.md](./21-testing.md)
- [24-meta.md](./24-meta.md)
