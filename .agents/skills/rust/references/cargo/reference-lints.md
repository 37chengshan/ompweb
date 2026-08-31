# Lints

Cargo supports a `[lints]` table for configuring lint levels for `rustc`, Clippy, and `rustdoc` lints, as well as Cargo's own lint system.

## `[lints]` Table in Cargo.toml (MSRV: 1.74)

Configure lint levels per tool:

```toml
[lints.rust]
unsafe_code = "forbid"
unused_variables = "warn"

[lints.clippy]
enum_glob_use = "deny"
pedantic = { level = "warn", priority = -1 }  # lint group with priority

[lints.rustdoc]
missing_crate_level_docs = "warn"
```

**Levels**: `"allow"`, `"warn"`, `"deny"`, `"forbid"`

**Priority**: Signed integer — lower value = lower priority. Useful when applying a group at low priority and overriding specific lints at higher priority:

```toml
[lints.clippy]
all = { level = "warn", priority = -1 }
dbg_macro = "deny"   # overrides "all" group for this specific lint
```

## Workspace Lint Inheritance (MSRV: 1.74)

Define lints once in the workspace root:

```toml
# Root Cargo.toml
[workspace.lints.rust]
unsafe_code = "forbid"

[workspace.lints.clippy]
enum_glob_use = "deny"
```

Each member must explicitly opt in:

```toml
# Member Cargo.toml
[lints]
workspace = true
```

Note: `workspace = true` is NOT automatic — it must be declared in each member.

## Cargo's Own Lint System (Nightly Only)

Cargo has its own experimental lints (only available on nightly toolchains).

### Lint Groups

| Group | Default Level | Description |
|-------|--------------|-------------|
| `cargo::complexity` | warn | Simple things done in complex ways |
| `cargo::correctness` | deny | Outright wrong or useless code |
| `cargo::nursery` | allow | New lints under development |
| `cargo::pedantic` | allow | Strict or occasionally false-positive lints |
| `cargo::perf` | warn | Code that could be faster |
| `cargo::restriction` | allow | Lints preventing use of Cargo features |
| `cargo::style` | warn | Non-idiomatic usage |
| `cargo::suspicious` | warn | Likely wrong or useless code |

### Warn-by-Default Cargo Lints

| Lint | Description |
|------|-------------|
| `non_kebab_case_bins` | Binary names should be kebab-case |
| `redundant_homepage` | Duplicate `package.homepage` |
| `redundant_readme` | Inferrable `package.readme` |
| `unknown_lints` | Unknown lints in `[lints.cargo]` |
| `unused_workspace_dependencies` | Unused entries in `[workspace.dependencies]` |
| `missing_lints_inheritance` | Package missing `[lints] workspace = true` when `workspace.lints` exists |

### Allow-by-Default Cargo Lints

| Lint | Description |
|------|-------------|
| `implicit_minimum_version_req` | Dependency versions without full `major.minor.patch` |
| `non_kebab_case_features` | Feature names not in kebab-case |
| `non_kebab_case_packages` | Package names not in kebab-case |

## Common Patterns

Forbid all unsafe code workspace-wide:

```toml
# Root Cargo.toml
[workspace.lints.rust]
unsafe_code = "forbid"

# Each member
[lints]
workspace = true
```

Enable strict Clippy lints at low priority with specific overrides:

```toml
[lints.clippy]
all = { level = "warn", priority = -1 }
pedantic = { level = "warn", priority = -1 }
must_use_candidate = "allow"   # too noisy for this project
```

## Notes

- The `[lints]` table in `Cargo.toml` is equivalent to passing `-A`/`-W`/`-D`/`-F` flags to `rustc`/`clippy`, but centralized and per-package.
- Cargo's own lint system is nightly-only and unstable.
- `workspace = true` and individual lint settings cannot be combined in the same `[lints]` table.

## Related

- [reference-manifest.md](./reference-manifest.md)
- [reference-workspaces.md](./reference-workspaces.md)
