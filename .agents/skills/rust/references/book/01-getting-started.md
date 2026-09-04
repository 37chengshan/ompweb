# Chapter 1: Getting Started

Introduction to Rust: installation, writing your first program, and using Cargo.

## Key Concepts

### Installation via rustup

```bash
# Linux/macOS
curl --proto '=https' --tlsv1.2 https://sh.rustup.rs -sSf | sh

# Verify
rustc --version

# Update / uninstall
rustup update
rustup self uninstall

# Open local offline docs
rustup doc
```

Windows: download the installer from https://www.rust-lang.org/tools/install (requires Visual Studio C++ tools).

### Hello, World!

```rust
fn main() {
    println!("Hello, world!");
}
```

```bash
rustc main.rs   # compile
./main          # run (Linux/macOS)
```

- `fn main()` is the entry point of every executable.
- `println!` is a macro (note the `!`).
- Lines end with `;`.
- Rust is ahead-of-time compiled — distribute the binary without requiring Rust on the target machine.
- Use `rustfmt` for automatic code formatting.

### Hello, Cargo

```bash
cargo new hello_cargo   # create a project
cargo build             # debug build → target/debug/
cargo run               # build + run
cargo check             # check compilation without producing binary (faster)
cargo build --release   # optimized build → target/release/
```

**Cargo.toml** structure:

```toml
[package]
name = "hello_cargo"
version = "0.1.0"
edition = "2024"

[dependencies]
```

- Source files live in `src/`.
- `Cargo.lock` locks exact dependency versions for reproducible builds.
- `cargo check` is fastest for iteration; use it frequently.

## Notes

- Rust file naming convention: `snake_case.rs`.
- The `[dependencies]` section lists external crates.
- Running `cargo new` inside an existing git repo skips `.git` initialization.

## Related

- [README](./README.md)
- [Chapter 2: Programming a Guessing Game](./02-guessing-game.md)
