# Packaging and Distributing a Rust Tool

Three main distribution strategies: publish to crates.io, ship pre-built binaries via CI, or submit to OS package managers.

## Signature / Usage

```toml
# Cargo.toml – recommended metadata before publishing
[package]
name = "grrs"
version = "0.1.0"
authors = ["Your Name <your@email.com>"]
license = "MIT OR Apache-2.0"
description = "A tool to search files"
readme = "README.md"
homepage = "https://github.com/you/grrs"
repository = "https://github.com/you/grrs"
keywords = ["cli", "search", "demo"]
categories = ["command-line-utilities"]
```

```console
# Publish to crates.io
$ cargo login <token>
$ cargo publish

# Install from crates.io
$ cargo install grrs

# Build a release binary locally
$ cargo build --release
# → target/release/grrs
```

## Options / Props

| Approach | Audience | Effort |
|----------|----------|--------|
| `cargo publish` / `cargo install` | Rust developers | Lowest |
| Pre-built binaries via CI (GitHub Actions / Travis CI) | General users | Medium |
| OS package managers (brew, deb, AUR …) | All users | Highest |

| Crate | Purpose |
|-------|---------|
| `cargo-bundle` | Bundle into OS-native packages |
| `cargo-deb` | Build `.deb` packages for Debian/Ubuntu |
| `cargo-aur` | Generate AUR packages for Arch Linux |
| `clap_mangen` | Generate `man` pages from `clap` definitions |
| `clap_complete` | Generate shell completion scripts |

## Notes

- `cargo install` compiles from source; the user needs a Rust toolchain, so it targets Rust developers.
- Pre-built binaries solve the "no Rust required" problem. Cross-compile for `x86_64-unknown-linux-musl` on Linux and set `MACOSX_DEPLOYMENT_TARGET` on macOS for maximum compatibility.
- [cross](https://github.com/rust-embedded/cross) (Docker-based cross-compiler) simplifies building for multiple targets locally.
- Distribute binaries as archive files (`.tar.gz`, `.zip`) attached to GitHub Releases.
- Recommended progression: start with `cargo publish`, then add binary releases, then OS package managers.
- ripgrep is the canonical example of a well-distributed Rust CLI tool.

## Related

- [project-setup.md](./project-setup.md)
- [parsing-arguments.md](./parsing-arguments.md)
- [in-depth-human-communication.md](./in-depth-human-communication.md)
