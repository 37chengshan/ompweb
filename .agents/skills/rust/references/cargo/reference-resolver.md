# Dependency Resolution

Cargo's dependency resolver determines which specific versions of dependencies to use. The result is stored in `Cargo.lock`.

## How the Resolver Works

The resolver uses a backtracking algorithm:

1. **Walk the dependency graph** — process packages in queue order
2. **Unify versions** — prefer reusing already-selected versions for compatibility
3. **Select versions** — prefer the highest available version within requirements
4. **Backtrack** — if a conflict arises, try alternative versions

The `Cargo.lock` file records the final resolution. Subsequent builds use locked versions for reproducibility.

## Version Selection

**Highest version wins** — within a version requirement range, Cargo selects the highest available:

```toml
bitflags = "1.0"   # >=1.0.0,<2.0.0 → selects 1.2.1 if available
```

**Compatible versions are unified** — if multiple packages require compatible versions of a dependency, only one copy is built:

```toml
# Package A: bitflags = "1.0"  (>=1.0.0,<2.0.0)
# Package B: bitflags = "1.1"  (>=1.1.0,<2.0.0)
# Result: one copy of bitflags 1.2.1
```

**Incompatible versions coexist** — if requirements are incompatible, multiple copies are built:

```toml
# Package A: rand = "0.7"   (>=0.7.0,<0.8.0)
# Package B: rand = "0.6"   (>=0.6.0,<0.7.0)
# Result: both rand 0.7.x and rand 0.6.x are built
```

**Warning**: Types from different versions of the same crate are incompatible at runtime.

## Lock File Priority

`Cargo.lock` takes precedence over version requirements for reproducibility:

```toml
bitflags = "*"   # Cargo.lock has 1.2.1 → uses 1.2.1 even if 1.3.5 is published
```

Changing the version requirement in `Cargo.toml` invalidates the lock entry and triggers re-resolution.

## Resolver Versions

```toml
[package]
resolver = "2"   # or in [workspace]
```

| Version | Default for | Key behavior |
|---------|-------------|-------------|
| `"1"` | edition < 2021 | Original resolver |
| `"2"` | edition = 2021 | Improved feature unification |
| `"3"` | edition = 2024 (Rust 1.84+) | MSRV-aware by default |

### Resolver v2 Feature Unification Improvements

Does NOT unify features in these cases:
- **Platform-specific**: target-specific features not unified on other platforms
- **Build-dependencies**: separate from normal dependencies (enables `no_std` with `std` build deps)
- **Dev-dependencies**: not unified with regular dependencies unless building tests/benchmarks

### Resolver v3

Changes `resolver.incompatible-rust-versions` default from `allow` to `fallback` — the resolver prefers versions compatible with your declared `rust-version`.

## MSRV-Aware Resolution

With `resolver = "3"` or the `fallback` setting:

```toml
[package]
name = "my-cli"
rust-version = "1.62"

[dependencies]
clap = "4.0"   # resolver prefers versions compatible with Rust 1.62
```

The resolver avoids selecting versions that require a newer Rust than your MSRV, but won't error if no compatible version exists.

## Feature Resolution

For `Cargo.lock` generation, features are resolved assuming all workspace members have all features enabled (ensures optional dependencies are fully resolved).

Feature unification: dependencies are built with the **union** of all features required by all dependents in the graph.

## Yanked Versions

Yanked releases are ignored in resolution unless:
- Already in `Cargo.lock`
- Explicitly requested with `cargo update --precise`

## Updating the Lock File

```bash
cargo update              # update all to latest compatible
cargo update -p regex     # update only "regex"
cargo update --precise regex 1.9.0  # pin to exact version
cargo update --recursive  # update package and its dependents
```

Flags to control resolution behavior:

```bash
cargo build --locked     # error if Cargo.lock needs updating
cargo build --frozen     # error if Cargo.lock differs or network needed
cargo build --offline    # avoid network access
```

## Troubleshooting

```bash
# Why is a dependency included?
cargo tree --workspace --target all --all-features --invert rand

# Why is a feature enabled?
cargo tree --workspace --target all --all-features --edges features --invert rand

# Find duplicate crate versions
cargo tree --workspace --target all --all-features --duplicates

# Debug resolver decisions
CARGO_LOG=cargo::core::resolver=trace cargo update
```

## Dev-Dependency Cycles

Allowed (unlike normal dependency cycles), since dev-dependencies are not needed for the main library build:

```toml
# foo/Cargo.toml
[dev-dependencies]
bar = "1.0"

# bar/Cargo.toml
[dependencies]
foo = { path = "../foo" }   # valid: bar only needs foo for its tests
```

## Notes

- Use caret requirements (`"1.2.3"`) for most dependencies — maximizes compatibility.
- Avoid `*` on crates.io and overly broad bounds (`>=2.0`).
- Use `=` version pinning for tightly coupled crate pairs (library + proc-macro).
- The `links` field in `Cargo.toml` ensures only one copy of a native library is linked per build.

## Related

- [reference-specifying-dependencies.md](./reference-specifying-dependencies.md)
- [reference-cargo-toml.md](./reference-cargo-toml.md)
- [reference-features.md](./reference-features.md)
- [reference-semver.md](./reference-semver.md)
