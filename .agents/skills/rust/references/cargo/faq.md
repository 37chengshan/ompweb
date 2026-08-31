# Cargo FAQ

Frequently asked questions about Cargo's design and behavior.

## Package Management

### Why use crates.io instead of GitHub as a registry?

crates.io offers advantages over GitHub-based packages:
- **Discoverability**: easy to find packages, see trends, identify popular crates
- **Speed**: efficiently fetch metadata and downloads without git repository overhead — significantly faster dependency resolution as graphs scale up

Git repositories are supported for early development and temporary patches, but crates.io is the primary source.

### Can libraries use `*` as a version for their dependencies?

No. crates.io has rejected wildcard dependency constraints since January 22nd, 2016. Libraries must specify the version range they support, even if broad (e.g., `"1"` for any `1.x.y`).

### Why `Cargo.toml` and not `cargo.toml` or `Cargofile`?

- **Leading capital `C`**: groups with similar config files (`Makefile`, `Dockerfile`) in directory listings
- **`.toml` extension**: emphasizes the [TOML format](https://toml.io/)
- Cargo rejects alternative names to prevent confusion and ensure easy project identification

## Build and Compilation

### Will Cargo work with C code?

Yes. Packages can specify a `build.rs` build script (written in Rust) that runs before `rustc`, which can compile C code (using crates like `cc`) and configure linking.

### Can Cargo be used inside `make` or other build systems?

Yes. Cargo returns proper exit codes and supports machine-readable JSON output (`--message-format=json`) for integration with other tools.

### Does Cargo support environments like `production` or `test`?

Yes, via [profiles](./reference-profiles.md):
- `dev` — default for `cargo build` (fast compilation, debug info)
- `release` — for `cargo build --release` (optimized)
- `test` — for `cargo test`
- Custom profiles via `[profile.NAME]` in `Cargo.toml`

### Does Cargo work on Windows?

Yes. All Cargo commits must pass the Windows test suite. Windows issues are treated as bugs.

## Lock Files

### Why commit `Cargo.lock` to version control?

For binaries and applications: committing `Cargo.lock` ensures deterministic builds. This is crucial for:
- `git bisect` — finding which commit introduced a bug
- CI consistency — failures come from code changes, not external dependency changes
- Reproducible deployments

For libraries published to crates.io: `Cargo.lock` is often omitted because downstream users generate their own lock file from `Cargo.toml` constraints.

### What's the difference between `--locked` and `--frozen`?

| Flag | Behavior |
|------|---------|
| `--locked` | Error if `Cargo.lock` needs to be updated |
| `--frozen` | Error if `Cargo.lock` needs updating OR if network access would be needed |
| `--offline` | Prevent all network access; use cached data |

## Offline Usage

### How can Cargo work offline?

```bash
# Option 1: pre-fetch then go offline
cargo fetch       # download all dependencies
cargo build --offline

# Option 2: vendor dependencies
cargo vendor
# then configure .cargo/config.toml with [source] replacement
cargo build --offline
```

See [Source Replacement](./reference-source-replacement.md) for vendoring details.

## Performance and Build Artifacts

### Why does my build take up so much disk space?

Cargo trades disk space for faster builds by:
- Maintaining a build cache of intermediate artifacts
- Caching separate entries for each toolchain version, package version, and feature combination
- Enabling incremental compilation for local packages
- Including debug info in the `dev` profile

To reduce disk usage:
- Run `cargo clean` to remove all artifacts
- Use `cargo install cargo-sweep` to remove old artifacts
- Set `[cache] auto-clean-frequency` in config to enable automatic cleanup

### Why is Cargo rebuilding my code unexpectedly?

Debug with:

```bash
CARGO_LOG=cargo::core::compiler::fingerprint=info cargo build
```

Common causes:
- Build script issue: emitting `cargo::rerun-if-changed=foo` for a file that doesn't exist
- Feature differences: same dependency built with different features by different workspace commands
- Filesystem with unusual timestamp behavior
- Concurrent background builds modifying artifacts

### How do I speed up builds?

- Use `cargo check` instead of `cargo build` when only checking for errors
- Use `sccache`: `RUSTC_WRAPPER=sccache cargo build`
- Optimize slow dependencies in dev: `[profile.dev.package."*"] opt-level = 2`
- Enable the parallel frontend (nightly): `-Z threads=N`
- Use the sparse registry protocol for faster index fetching

## Dependency Conflicts

### What does "version conflict" mean and how do I resolve it?

Error: `failed to select a version for 'x' which could resolve this conflict`

Causes and solutions:

1. **Duplicate `links` value**: multiple packages declare the same `links` key — use the `-sys` package convention
2. **Version incompatibility**: two packages require conflicting versions — modify requirements to be compatible
3. **Minimum version issue** (with `direct-minimal-versions`): update direct dependency version minimums
4. **Missing features**: a required feature doesn't exist in the specified version
5. **Merge conflict**: reset lock file changes and re-run `cargo check`

Debugging commands:

```bash
cargo tree --workspace --target all --all-features --invert <crate>   # who requires it?
cargo tree --workspace --target all --all-features --duplicates        # find duplicates
CARGO_LOG=cargo::core::resolver=trace cargo update                     # resolver trace
```

## Related

- [cargo-guide.md](./cargo-guide.md)
- [reference-resolver.md](./reference-resolver.md)
- [reference-profiles.md](./reference-profiles.md)
- [reference-source-replacement.md](./reference-source-replacement.md)
- [reference-cargo-toml.md](./reference-cargo-toml.md)
