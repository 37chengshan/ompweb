# Getting Started with Cargo

Cargo is the Rust package manager and build tool. It handles downloading dependencies, compiling packages, and distributing Rust libraries. Installing Rust via rustup automatically installs Cargo.

## Installation

### Linux and macOS

```bash
curl https://sh.rustup.rs -sSf | sh
```

### Windows

Download and run [rustup-init.exe](https://win.rustup.rs/). Additional release channels (`beta`, `nightly`) can be installed with `rustup`.

Alternative: [build from source](https://github.com/rust-lang/cargo#compiling-from-source).

## Creating a New Package

```bash
cargo new hello_world        # binary crate (default)
cargo new --lib my_library   # library crate
cargo init                   # initialize in existing directory
```

Generated structure:

```
hello_world/
├── Cargo.toml
└── src/
    └── main.rs
```

Default `Cargo.toml`:

```toml
[package]
name = "hello_world"
version = "0.1.0"
edition = "2024"

[dependencies]
```

## Building and Running

```bash
cargo build              # compile (debug mode → target/debug/)
cargo build --release    # compile with optimizations (→ target/release/)
cargo run                # compile + run
cargo check              # check for errors without producing an artifact
cargo test               # run tests
cargo doc --open         # generate and open documentation
cargo clean              # remove build artifacts
```

## Notes

- `cargo new` initializes a git repository by default. Use `--vcs none` to skip.
- Debug builds are faster to compile; release builds are faster to execute.
- `cargo check` is significantly faster than `cargo build` during development.

## Related

- [cargo-guide.md](./cargo-guide.md)
- [reference-manifest.md](./reference-manifest.md)
- [commands.md](./commands.md)
