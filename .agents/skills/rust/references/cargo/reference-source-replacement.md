# Source Replacement

Source replacement redirects Cargo's communication with a registry or git source to an alternative. It is used for vendoring (offline builds) and mirroring (caching).

**Key constraint**: The replacement source must contain identical source code — it cannot add crates not in the original source.

For patching individual packages (different code), use `[patch]` instead. For private registries, see [Registries](./reference-registries.md).

## Configuration

Source replacement is configured in `.cargo/config.toml`:

```toml
[source.crates-io]
replace-with = "my-vendor"

[source.my-vendor]
directory = "vendor"
```

## Source Types

### Directory Source (for vendoring)

Contains unpacked crate source trees. Suitable for committing to version control.

```toml
[source.vendored]
directory = "vendor"
```

Generated and managed by `cargo vendor`:

```bash
cargo vendor                    # vendor all dependencies into vendor/
cargo vendor --sync Cargo.toml  # update vendored deps
```

After vendoring, add to `.cargo/config.toml`:

```toml
[source.crates-io]
replace-with = "vendored-sources"

[source.vendored-sources]
directory = "vendor"
```

### Local Registry Source

A filesystem subset of a registry (contains `.crate` files and an `index/` directory). Managed with [`cargo-local-registry`](https://crates.io/crates/cargo-local-registry).

```toml
[source.local-mirror]
local-registry = "path/to/registry"
```

### Registry Source (Mirror)

Replace with a different registry (git or sparse):

```toml
[source.crates-io]
replace-with = "mirror"

[source.mirror]
registry = "https://mirror.example.com/crates-io"
# or sparse:
registry = "sparse+https://mirror.example.com/index"
```

### Git Source

Replace a git-based dependency with an alternative:

```toml
[source.my-git-source]
git = "https://example.com/path/to/repo"
branch = "main"
replace-with = "local-git"

[source.local-git]
git = "https://internal.example.com/path/to/repo"
```

## Complete Vendoring Example

```bash
# 1. Vendor dependencies
cargo vendor

# 2. Configure source replacement (cargo vendor prints this)
# Add to .cargo/config.toml:
[source.crates-io]
replace-with = "vendored-sources"

[source.vendored-sources]
directory = "vendor"

# 3. Build offline
cargo build --offline
```

## Notes

- Source replacement only affects where Cargo fetches code from — package names, versions, and checksums must match.
- When using source replacement with registries, commands contacting the registry directly (e.g., `cargo publish`) require the `--registry` option to avoid ambiguity and use correct authentication.
- Directory sources include checksums in metadata files to prevent accidental modifications.
- `cargo vendor` can handle workspaces with multiple `Cargo.toml` files via `--sync`.

## Related

- [reference-registries.md](./reference-registries.md)
- [reference-overriding-dependencies.md](./reference-overriding-dependencies.md)
- [reference-config.md](./reference-config.md)
- [commands.md](./commands.md)
