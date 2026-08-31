# Features

Cargo features provide a mechanism for conditional compilation and optional dependencies. Features are declared in `[features]` in `Cargo.toml` and enabled at compile time.

## Defining Features

```toml
[features]
default = ["ico", "webp"]   # enabled by default
bmp = []
png = []
ico = ["bmp", "png"]        # enables other features
webp = []
```

In Rust code:

```rust
#[cfg(feature = "webp")]
pub mod webp;
```

## Feature Naming Rules

- Unicode XID characters, `_`, `-`, `+`, `.` are allowed
- On crates.io: ASCII alphanumeric, `_`, `-`, `+` only
- Max 300 features per crate on crates.io

## Default Features

Features are disabled by default unless listed in `default`. Consumers can disable defaults:

```toml
[dependencies]
image = { version = "1.0", default-features = false, features = ["png"] }
```

Or via CLI:

```bash
cargo build --no-default-features --features png
```

## Optional Dependencies

Optional dependencies implicitly create a feature of the same name:

```toml
[dependencies]
gif = { version = "0.11.1", optional = true }
# implicitly creates: [features] gif = ["dep:gif"]
```

### Custom Feature Names with `dep:` Prefix

Use `dep:` to decouple feature names from dependency names (requires Rust 1.60+):

```toml
[dependencies]
ravif = { version = "0.6.3", optional = true }
rgb = { version = "0.8.25", optional = true }

[features]
avif = ["dep:ravif", "dep:rgb"]   # avif feature controls both deps
```

## Enabling Dependency Features

```toml
[dependencies]
serde = { version = "1.0", features = ["derive"] }
jpeg-decoder = { version = "0.1", default-features = false }

[features]
parallel = ["jpeg-decoder/rayon"]   # enable rayon feature of jpeg-decoder
```

### Conditional Feature Activation with `?`

Only enable a dependency's feature if that dependency is already enabled (requires Rust 1.60+):

```toml
[features]
serde = ["dep:serde", "rgb?/serde"]  # rgb's serde only if rgb is already enabled
```

## Command-Line Feature Control

```bash
cargo build --features "foo bar"
cargo build --features foo/foo-feat,bar/bar-feat
cargo build --all-features
cargo build --no-default-features
```

## Feature Unification

When a dependency appears multiple times in the dependency graph, Cargo builds it with the **union of all features** requested by all dependents. Features must therefore be additive — enabling a feature should not break other feature combinations.

## Feature Resolver Version 2

```toml
[package]
resolver = "2"
```

Resolver v2 avoids unifying features in these cases:
1. Platform-specific dependencies for non-target architectures
2. Build-dependencies and proc-macros (separate from normal dependencies)
3. Dev-dependencies (unless building test/bench targets)

This allows, for example, a `no_std` library to work even when a build-dependency enables `std`.

## Inspecting Features

```bash
cargo tree -e features               # show feature edges
cargo tree -f "{p} {f}"              # compact feature list per crate
cargo tree -e features -i serde      # what enables "serde" features
cargo tree --duplicates              # find duplicate crate versions
```

## Build Script Access

Features are available in build scripts via environment variables:

```
CARGO_FEATURE_<NAME>   # set if feature NAME is active (uppercase, - → _)
```

## SemVer Notes

| Change | Classification |
|--------|---------------|
| Add a new feature | Minor (safe) |
| Add optional dependency | Minor (safe) |
| Remove a feature | **Major** (breaking) |
| Move public item behind a feature | **Major** (breaking) |
| Remove item from default | **Major** (breaking) |

## Mutually Exclusive Features (Discouraged)

```rust
#[cfg(all(feature = "foo", feature = "bar"))]
compile_error!("features \"foo\" and \"bar\" cannot be used together");
```

Prefer splitting into separate packages or using runtime configuration instead.

## Related

- [reference-manifest.md](./reference-manifest.md)
- [reference-specifying-dependencies.md](./reference-specifying-dependencies.md)
- [reference-resolver.md](./reference-resolver.md)
- [reference-semver.md](./reference-semver.md)
