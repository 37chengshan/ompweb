# Profiles

Profiles configure compiler settings for different build scenarios. They are defined in `[profile.NAME]` sections in `Cargo.toml` (workspace root only).

## Built-in Profiles

| Profile | Triggered by | Inherits from |
|---------|-------------|---------------|
| `dev` | `cargo build`, `cargo run`, `cargo check` | — |
| `release` | `--release` flag, `cargo install` | — |
| `test` | `cargo test` | `dev` |
| `bench` | `cargo bench` | `release` |

## Profile Settings

```toml
[profile.dev]
opt-level = 0           # 0 | 1 | 2 | 3 | "s" (size) | "z" (min size)
debug = true            # false/"none" | "line-tables-only" | "limited"/1 | true/"full"/2
split-debuginfo = "..."  # platform-specific
strip = "none"          # "none" | "debuginfo" | "symbols"
debug-assertions = true  # enables cfg(debug_assertions)
overflow-checks = true   # integer overflow panics
lto = false             # false/"off" | "thin" | true/"fat"
panic = "unwind"        # "unwind" | "abort"
incremental = true
codegen-units = 256     # parallel codegen units (higher = faster compile, less optimization)
rpath = false
```

## Default Values

**dev profile:**

```toml
[profile.dev]
opt-level = 0
debug = true
debug-assertions = true
overflow-checks = true
incremental = true
codegen-units = 256
```

**release profile:**

```toml
[profile.release]
opt-level = 3
debug = false
debug-assertions = false
overflow-checks = false
incremental = false
codegen-units = 16
```

## Custom Profiles

```toml
[profile.release-lto]
inherits = "release"
lto = true
codegen-units = 1
```

```bash
cargo build --profile release-lto
# Output → target/release-lto/
```

## Profile Overrides

### Per-Package Override

```toml
# Optimize a specific dependency even in dev mode
[profile.dev.package.image]
opt-level = 3

# Optimize all non-workspace dependencies
[profile.dev.package."*"]
opt-level = 2

# Specific version
[profile.dev.package."foo:2.1.0"]
opt-level = 3
```

### Build Script Override

```toml
[profile.dev.build-override]
opt-level = 0
codegen-units = 256
```

### Override Precedence (highest → lowest)

1. Named package: `[profile.dev.package.NAME]`
2. All non-workspace deps: `[profile.dev.package."*"]`
3. Build scripts/proc-macros: `[profile.dev.build-override]`
4. Profile settings: `[profile.dev]`
5. Cargo built-in defaults

Note: Overrides cannot specify `panic`, `lto`, or `rpath`.

## Profile Selection

```bash
cargo build               # uses dev
cargo build --release     # uses release
cargo build --profile release-lto  # uses custom profile
```

## Notes

- Profile settings in `Cargo.toml` only apply when that manifest is the workspace root. Dependency profile settings are ignored.
- Config files (`.cargo/config.toml`) and environment variables can override `Cargo.toml` profile settings.
- `lto = true` ("fat" LTO) produces smaller, faster binaries at the cost of much longer link times.
- For generics-heavy code, `opt-level = 1` for dependencies may be better than 0 (improves sharing of generic instantiations).
- String-based debug values (`"none"`, `"limited"`, `"full"`) require Rust 1.71+.

## Common Recipes

Faster test compilation with optimized dependencies:

```toml
[profile.dev.package."*"]
opt-level = 2
```

Minimal release binary size:

```toml
[profile.release]
opt-level = "z"
lto = true
codegen-units = 1
strip = "symbols"
panic = "abort"
```

## Related

- [reference-manifest.md](./reference-manifest.md)
- [reference-config.md](./reference-config.md)
