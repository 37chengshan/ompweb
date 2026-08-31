# The Manifest Format (Cargo.toml)

`Cargo.toml` is the manifest file for each Rust package, written in TOML. It declares metadata, dependencies, build targets, and compilation settings.

## `[package]` Section

Only `name` is strictly required; `version` and other fields are required for publishing to crates.io.

```toml
[package]
name = "my-project"           # required; alphanumeric, -, _ only
version = "0.1.0"             # SemVer (required for publishing)
edition = "2024"              # Rust edition: 2015 | 2021 | 2024 (default: 2015)
description = "A short description"
license = "MIT OR Apache-2.0" # SPDX 2.3 expression
repository = "https://github.com/example/my-project"
readme = "README.md"
keywords = ["cli", "tool"]    # max 5, 20 chars each
categories = ["command-line-utilities"]  # max 5, from crates.io list
rust-version = "1.70"         # minimum supported Rust version (MSRV)
build = "build.rs"            # build script path (default: build.rs)
default-run = "main"          # default binary for cargo run
publish = false               # or list of allowed registries
```

### File Include/Exclude

```toml
[package]
exclude = ["/ci", "images/", ".*"]
include = ["/src", "COPYRIGHT", "/examples"]
```

- Always excluded: sub-packages, `target/`
- Always included: `Cargo.toml`, `Cargo.lock`, the `license-file`

## Dependency Sections

```toml
[dependencies]          # library dependencies
serde = "1.0"

[dev-dependencies]      # only for tests, examples, benchmarks
tempfile = "3"

[build-dependencies]    # only for build scripts
cc = "1.0"

[target.'cfg(windows)'.dependencies]   # platform-specific
winapi = "0.3"
```

## Feature Configuration

```toml
[features]
default = ["std"]
std = []
async = ["dep:tokio"]
```

## Target Tables

```toml
[lib]
name = "mylib"
crate-type = ["cdylib"]  # rlib | dylib | cdylib | staticlib | proc-macro

[[bin]]
name = "my-binary"
path = "src/bin/main.rs"

[[example]]
name = "demo"
required-features = ["async"]

[[test]]
name = "integration"

[[bench]]
name = "benchmarks"
```

Auto-discovery is enabled by default (`autolib`, `autobins`, `autoexamples`, `autotests`, `autobenches`). Set to `false` to disable.

## Workspace Section

```toml
[workspace]
members = [".", "crates/foo"]
```

## Lints Section (MSRV: 1.74)

```toml
[lints.rust]
unsafe_code = "forbid"

[lints.clippy]
enum_glob_use = "deny"
```

## Profile Sections

```toml
[profile.release]
opt-level = 3
lto = true
```

## Patch Section

```toml
[patch.crates-io]
uuid = { path = "../uuid" }
```

## Package Metadata (tool-specific)

```toml
[package.metadata.tool-name]
key = "value"   # ignored by Cargo; for external tools
```

## Notes

- `name` on crates.io: ASCII only, max 64 chars, no reserved names
- `keywords`: alphanumeric + `_-+`, max 5 entries
- `categories` must exactly match [crates.io category slugs](https://crates.io/category_slugs)
- `version` must be three-part SemVer (e.g., `1.0.0-alpha.1`)
- Required for crates.io: `name`, `version`, `description`, and `license` or `license-file`

## Related

- [reference-workspaces.md](./reference-workspaces.md)
- [reference-specifying-dependencies.md](./reference-specifying-dependencies.md)
- [reference-features.md](./reference-features.md)
- [reference-profiles.md](./reference-profiles.md)
- [reference-build-scripts.md](./reference-build-scripts.md)
