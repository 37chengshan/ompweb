# Specifying Dependencies

Dependencies are declared in `Cargo.toml` under `[dependencies]`, `[dev-dependencies]`, `[build-dependencies]`, or platform-specific sections.

## Version Requirement Syntax

### Default / Caret (`^`)

The default strategy — allows SemVer-compatible updates. The leftmost non-zero component must match:

```
"1.2.3"  == "^1.2.3"  →  >=1.2.3, <2.0.0
"0.2.3"               →  >=0.2.3, <0.3.0
"0.0.3"               →  >=0.0.3, <0.0.4
```

### Tilde (`~`)

Allows patch-level changes:

```
~1.2.3  →  >=1.2.3, <1.3.0
~1.2    →  >=1.2.0, <1.3.0
~1      →  >=1.0.0, <2.0.0
```

### Wildcard (`*`)

```
*     →  >=0.0.0
1.*   →  >=1.0.0, <2.0.0
1.2.* →  >=1.2.0, <1.3.0
```

Note: crates.io does not allow bare `*` requirements.

### Comparison

```toml
my-dep = ">= 1.2.0"
my-dep = "> 1"
my-dep = "= 1.2.3"      # exact pin
my-dep = ">= 1.2, < 1.5"  # multiple requirements (comma-separated)
```

### Pre-releases

Pre-release versions are excluded unless explicitly specified:

```toml
foo = "1.0.0-alpha"
```

## Dependency Sources

### crates.io (default)

```toml
[dependencies]
serde = "1.0"
```

### Git Repository

```toml
[dependencies]
regex = { git = "https://github.com/rust-lang/regex.git" }
regex = { git = "https://github.com/rust-lang/regex.git", branch = "next" }
regex = { git = "https://github.com/rust-lang/regex.git", tag = "1.10.3" }
regex = { git = "https://github.com/rust-lang/regex.git", rev = "4c59b707" }
```

### Path (local)

```toml
[dependencies]
my-utils = { path = "../my-utils" }
```

Path-only dependencies cannot be published to crates.io. Combine with `version` for publishable crates:

```toml
[dependencies]
my-utils = { path = "../my-utils", version = "1.0" }
```

### Alternate Registry

```toml
[dependencies]
private-crate = { version = "1.0", registry = "my-registry" }
```

## Specialized Dependencies

### Platform-Specific

```toml
[target.'cfg(windows)'.dependencies]
winapi = "0.3"

[target.'cfg(unix)'.dependencies]
openssl = "1.0"

[target.x86_64-pc-windows-gnu.dependencies]
winhttp = "0.4"
```

### Development Dependencies (tests, examples, benchmarks)

```toml
[dev-dependencies]
tempfile = "3"
assert_cmd = "2"

[target.'cfg(unix)'.dev-dependencies]
mio = "0.8"
```

### Build Script Dependencies

```toml
[build-dependencies]
cc = "1.0"

[target.'cfg(unix)'.build-dependencies]
cc = "1.0"
```

## Feature Selection

```toml
[dependencies]
serde = { version = "1.0", features = ["derive"] }
flate2 = { version = "1.0", default-features = false, features = ["zlib-rs"] }
```

## Dependency Renaming

```toml
[dependencies]
foo = "0.1"
bar = { git = "https://github.com/example/project.git", package = "foo" }
# Use as "bar" in code, but points to the "foo" package
```

## Inheriting from Workspace (MSRV: 1.64)

```toml
[dependencies]
serde = { workspace = true, features = ["derive"] }

[build-dependencies]
cc.workspace = true
```

## Notes

- Cargo always selects the highest version within the specified range unless `Cargo.lock` is present.
- Avoid overly broad (`>=2.0`) or overly narrow (`=1.2.3`) requirements for library crates.
- Use `=` for tightly coupled crate pairs (e.g., a library and its proc-macro crate).

## Related

- [reference-cargo-toml.md](./reference-cargo-toml.md)
- [reference-overriding-dependencies.md](./reference-overriding-dependencies.md)
- [reference-features.md](./reference-features.md)
- [reference-resolver.md](./reference-resolver.md)
- [reference-semver.md](./reference-semver.md)
