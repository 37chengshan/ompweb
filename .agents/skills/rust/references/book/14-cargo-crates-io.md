# Chapter 14: More about Cargo and Crates.io

Release profiles, documentation, publishing, workspaces, and installing binaries.

## Release Profiles

```toml
# Cargo.toml
[profile.dev]       # cargo build
opt-level = 0       # fast compile, no optimization

[profile.release]   # cargo build --release
opt-level = 3       # slow compile, maximum optimization
```

Override any default setting by adding a `[profile.*]` section.

## Documentation Comments

```rust
/// Adds one to the given number.
///
/// # Examples
///
/// ```
/// let result = my_crate::add_one(5);
/// assert_eq!(6, result);
/// ```
///
/// # Panics
/// Never panics.
///
/// # Errors
/// Returns `Err` if … (for Result-returning functions)
pub fn add_one(x: i32) -> i32 { x + 1 }

//! # My Crate
//! Crate-level documentation (place at top of src/lib.rs)
```

```bash
cargo doc          # generate HTML docs in target/doc/
cargo doc --open   # build and open in browser
cargo test         # also runs code examples in doc comments as tests
```

## Re-exporting for Convenient Public API

```rust
// src/lib.rs
pub use self::kinds::PrimaryColor;
pub use self::utils::mix;
```

Users can then write `use art::PrimaryColor` instead of `use art::kinds::PrimaryColor`.

## Publishing to Crates.io

```toml
[package]
name        = "my_crate"
version     = "0.1.0"
edition     = "2024"
description = "A brief description"
license     = "MIT OR Apache-2.0"
```

```bash
cargo login          # store API token from crates.io/me
cargo publish        # publish current version (permanent)
cargo yank --vers 1.0.1          # prevent new projects from using this version
cargo yank --vers 1.0.1 --undo   # reverse a yank
```

- Publishes are **permanent** — versions cannot be deleted.
- Yank prevents new dependencies but does not break existing ones.
- Follow [Semantic Versioning](https://semver.org/) for version bumps.

## Cargo Workspaces

```toml
# workspace root Cargo.toml
[workspace]
resolver = "3"
members = ["adder", "add_one"]
```

```
add/
├── Cargo.lock       # shared across all crates
├── Cargo.toml       # workspace config
├── target/          # shared output directory
├── adder/           # binary crate
│   ├── Cargo.toml
│   └── src/main.rs
└── add_one/         # library crate
    ├── Cargo.toml
    └── src/lib.rs
```

Inter-crate dependency in `adder/Cargo.toml`:

```toml
[dependencies]
add_one = { path = "../add_one" }
```

```bash
cargo build              # build all crates
cargo build -p adder     # build specific crate
cargo test -p add_one    # test specific crate
```

- Shared `Cargo.lock` ensures all crates use the same dependency versions.
- Each external dependency must be declared per-crate even if the version is shared.

## Installing Binaries

```bash
cargo install ripgrep    # install binary crate from crates.io
```

Binaries are installed in `~/.cargo/bin/`. Only crates with binary targets can be installed.

## Notes

- `cargo check` (from Chapter 1) is the fastest feedback loop; use it during development.
- `opt-level` ranges from `0` (no optimization) to `3` (full); `"s"` / `"z"` optimize for size.
- Common license for open-source Rust crates: `"MIT OR Apache-2.0"`.

## Related

- [Chapter 7: Packages, Crates, and Modules](./07-packages-crates-modules.md)
- [Chapter 11: Testing](./11-testing.md)
