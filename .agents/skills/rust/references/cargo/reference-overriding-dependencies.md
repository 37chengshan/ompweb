# Overriding Dependencies

Cargo provides mechanisms to temporarily override dependencies — useful for testing local bug fixes, working with unpublished code, or testing breaking changes before publication.

## The `[patch]` Section (Recommended)

Override dependencies in the workspace root `Cargo.toml`. Applies transitively throughout the entire dependency graph.

```toml
[patch.crates-io]
foo = { path = "../path/to/foo" }
bar = { git = "https://github.com/example/bar.git" }

[patch.'https://github.com/example/baz']
baz = { git = "https://github.com/example/patched-baz.git", branch = "my-fix" }
```

### Common Use Cases

**Testing a local bug fix:**

```toml
[dependencies]
uuid = "1.0"

[patch.crates-io]
uuid = { path = "../uuid" }   # local checkout with your fix
```

**Using an unpublished minor version from git:**

```toml
[dependencies]
uuid = "1.0.1"

[patch.crates-io]
uuid = { git = "https://github.com/uuid-rs/uuid.git" }
```

**Testing a pre-release breaking change (major version bump):**

```toml
[dependencies]
uuid = "2.0"

[patch.crates-io]
uuid = { git = "https://github.com/uuid-rs/uuid.git", branch = "2.0.0" }
```

**Multiple versions of the same crate:**

```toml
[patch.crates-io]
serde = { git = "https://github.com/serde-rs/serde.git" }
serde2 = { git = "https://github.com/example/serde.git", package = "serde", branch = "v2" }
```

**Overriding a non-crates.io source:**

```toml
[patch."https://github.com/your/repository"]
my-library = { path = "../my-library" }
```

### Via Command Line

```bash
cargo build --config 'patch.crates-io.uuid.path="uuid"'
```

## `paths` Overrides (Temporary / Config-level)

For local-only overrides without touching `Cargo.toml`, add to `.cargo/config.toml`:

```toml
paths = ["/path/to/uuid"]
```

**Limitations compared to `[patch]`:**
- Cannot change the dependency graph structure (no new dependencies)
- Only works for crates.io dependencies
- More restrictive — use `[patch]` for most cases

## The `[replace]` Section (Deprecated)

`[replace]` is deprecated in favor of `[patch]`. Requires an exact three-part version:

```toml
[replace]
"foo:0.1.0" = { git = "https://github.com/example/foo.git" }
"bar:1.0.2" = { path = "my/local/bar" }
```

Use `[patch]` instead.

## Notes

- `[patch]` is only read from the workspace root manifest; it is ignored in dependency `Cargo.toml` files.
- The patched version must be compatible with the original version requirement (same major version for caret reqs) unless using pre-release tricks.
- Cargo.lock records which patches were applied.

## Related

- [reference-specifying-dependencies.md](./reference-specifying-dependencies.md)
- [reference-source-replacement.md](./reference-source-replacement.md)
- [reference-resolver.md](./reference-resolver.md)
