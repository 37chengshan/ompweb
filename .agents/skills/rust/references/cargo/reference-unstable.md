# Unstable Features

Unstable features are experimental Cargo capabilities available only on the **nightly toolchain**. They allow community testing before stabilization. Features with no major concerns are stabilized and appear on stable 6–12 weeks later.

## How to Enable

### New Cargo.toml Syntax

```toml
cargo-features = ["test-dummy-unstable"]

[package]
name = "my-package"
version = "0.1.0"
```

### Command-Line Flags

```bash
cargo +nightly build --artifact-dir=out -Z unstable-options
cargo +nightly build -Z mtime-on-use
```

### Config File

```toml
# .cargo/config.toml
[unstable]
mtime-on-use = true
build-std = ["core", "alloc"]
```

List all available `-Z` flags:

```bash
cargo -Z help
```

## Key Unstable Features

### Build and Compilation

| Feature | Description |
|---------|-------------|
| `build-std` | Compile the standard library from source instead of using pre-built binaries |
| `build-std-features` | Configure standard library features when using `build-std` |
| `mtime-on-use` | Update file modification times for better cache management |
| `panic-abort-tests` | Compile tests with `panic = "abort"` strategy |
| `host-config` | Separate configuration for host and target build platforms |
| `checksum-freshness` | Use checksums instead of mtimes to detect stale build artifacts |
| `build-dir-new-layout` | Enable new build directory filesystem layout |

### Resolver and Dependencies

| Feature | Description |
|---------|-------------|
| `minimal-versions` | Force resolver to use the lowest compatible versions (for testing minimum version compliance) |
| `direct-minimal-versions` | Use minimum versions for direct dependencies only |
| `avoid-dev-deps` | Skip downloading dev-dependencies when not needed |
| `public-dependency` | Mark dependencies as `public` or `private` to control re-exports |
| `msrv-policy` | MSRV-aware resolver and version selection |
| `update-breaking` | Allow `cargo update` to make SemVer-incompatible upgrades |

### Output and Artifacts

| Feature | Description |
|---------|-------------|
| `artifact-dir` | Copy built artifacts to a specified directory after build |
| `unit-graph` | Output JSON of Cargo's internal dependency compilation graph |
| `artifact-dependencies` | Depend on binary/library artifacts for use at build time |

### Documentation

| Feature | Description |
|---------|-------------|
| `rustdoc-map` | Map external documentation links to custom URLs (e.g., docs.rs) |
| `scrape-examples` | Include workspace example code in generated documentation |
| `output-format` | Generate documentation in JSON format |

### Paths and Environment

| Feature | Description |
|---------|-------------|
| `trim-paths` | Sanitize file paths embedded in binaries and diagnostics |
| `per-package-target` | Set `--target` per package via `forced-target` in `Cargo.toml` |
| `lockfile-path` | Specify a custom lockfile location |

### Advanced

| Feature | Description |
|---------|-------------|
| `gitoxide` | Use the `gitoxide` library instead of `git2` for git operations |
| `script` | Run single-file `.rs` packages directly (`cargo +nightly script my-script.rs`) |
| `gc` | Global cache garbage collection with configurable frequency |

## Example: artifact-dir

```bash
cargo +nightly build --artifact-dir=out -Z unstable-options
# Built artifacts are copied to out/
```

## Example: build-std

```toml
# .cargo/config.toml
[unstable]
build-std = ["core", "alloc"]

[build]
target = "thumbv7em-none-eabihf"
```

```bash
cargo +nightly build -Z build-std
```

## Notes

- Unstable features require the `nightly` toolchain. Use `rustup install nightly` if needed.
- Feature availability and behavior can change without notice.
- Check the official [Unstable Features page](https://doc.rust-lang.org/cargo/reference/unstable.html) for the current status of each feature and links to tracking issues.
- Some unstable features eventually become default behavior without explicit opt-in after stabilization.

## Related

- [reference-resolver.md](./reference-resolver.md)
- [reference-profiles.md](./reference-profiles.md)
- [reference-build-scripts.md](./reference-build-scripts.md)
- [commands.md](./commands.md)
