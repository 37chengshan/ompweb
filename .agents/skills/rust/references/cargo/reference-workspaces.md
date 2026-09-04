# Workspaces

A workspace is a collection of one or more Cargo packages (workspace members) managed together under a single `Cargo.lock` and shared `target/` directory.

## Types of Workspaces

### Root Package Workspace

The workspace root also contains a package:

```toml
# /Cargo.toml
[workspace]
members = ["crates/foo", "crates/bar"]

[package]
name = "my-app"
version = "0.1.0"
```

### Virtual Workspace

No package at the root — only a workspace manifest:

```toml
# /Cargo.toml
[workspace]
members = ["crates/foo", "crates/bar"]
resolver = "3"
```

## Key Benefits

- Shared `Cargo.lock` — all members use consistent dependency versions
- Shared `target/` directory — avoids duplicate compilation
- Unified commands — `cargo build --workspace`, `cargo test --workspace`
- Shared configuration via `workspace.package` and `workspace.dependencies`

## Configuration

### `members` and `exclude`

```toml
[workspace]
members = ["crates/*", "tools/helper"]
exclude = ["crates/experimental"]
```

Supports glob patterns. Path dependencies referenced from workspace members are automatically included.

### `default-members`

Packages operated on when in the workspace root without `--package` or `--workspace`:

```toml
[workspace]
members = ["app", "lib"]
default-members = ["app"]
```

### `workspace.package` — Shared Package Fields (MSRV: 1.64)

```toml
# Root Cargo.toml
[workspace.package]
version = "1.2.3"
edition = "2021"
authors = ["Alice <alice@example.com>"]
license = "MIT"

# Member Cargo.toml
[package]
name = "my-crate"
version.workspace = true
edition.workspace = true
authors.workspace = true
license.workspace = true
```

Inheritable keys: `authors`, `categories`, `description`, `documentation`, `edition`, `exclude`, `homepage`, `include`, `keywords`, `license`, `license-file`, `publish`, `readme`, `repository`, `rust-version`, `version`

### `workspace.dependencies` — Shared Dependencies (MSRV: 1.64)

```toml
# Root Cargo.toml
[workspace.dependencies]
serde = { version = "1.0", features = ["derive"] }
tokio = { version = "1", features = ["full"] }
cc = "1.0"

# Member Cargo.toml
[dependencies]
serde.workspace = true
tokio = { workspace = true, features = ["macros"] }  # can add features

[build-dependencies]
cc.workspace = true
```

### `workspace.lints` — Shared Lint Configuration (MSRV: 1.74)

```toml
# Root Cargo.toml
[workspace.lints.rust]
unsafe_code = "forbid"

[workspace.lints.clippy]
enum_glob_use = "deny"

# Member Cargo.toml
[lints]
workspace = true  # explicitly opt in
```

### `resolver`

```toml
[workspace]
resolver = "3"   # "1" | "2" | "3"; required in virtual workspaces
```

### `workspace.metadata`

```toml
[workspace.metadata.my-tool]
key = "value"   # ignored by Cargo; for external tools
```

## Package Selection

```bash
cargo build -p foo          # build specific package
cargo build --workspace     # build all members
cargo test --workspace      # test all members
```

## Notes

- Profile settings (`[profile.*]`), `[patch]`, and `[replace]` are only recognized in the workspace root manifest.
- `workspace.lints` is not automatically inherited — each member must explicitly set `[lints] workspace = true`.
- Workspace members share a single resolved `Cargo.lock`; dependency versions are unified across all members.

## Related

- [reference-manifest.md](./reference-manifest.md)
- [reference-specifying-dependencies.md](./reference-specifying-dependencies.md)
- [reference-resolver.md](./reference-resolver.md)
- [reference-profiles.md](./reference-profiles.md)
