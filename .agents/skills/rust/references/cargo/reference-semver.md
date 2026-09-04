# SemVer Compatibility

Semantic Versioning (SemVer) defines what changes require a major, minor, or patch version bump. These are guidelines — the focus is on changes that cause **compilation failures** in downstream crates.

## Version Bump Categories

| Version Change | Meaning |
|----------------|---------|
| `X.0.0` (major) | Breaking change — previously working code no longer compiles |
| `0.X.0` (minor) | Additive change — new functionality without breaking existing code |
| `0.0.X` (patch) | Bug fix — no API change |

## Items (Functions, Types, Constants)

| Change | Classification |
|--------|---------------|
| Renaming / moving / removing a public item | **Major** |
| Adding a new public item | Minor |

```rust
// Before: pub fn foo() {}
// After:  removed
// Breaks: updated_crate::foo();
```

**Mitigation**: Mark as `#[deprecated]` first, remove in a later major release.

## Structs

| Change | Classification |
|--------|---------------|
| Adding a private field when all fields were public | **Major** |
| Adding a public field when no private field exists | **Major** |
| Adding/removing private fields when one already exists | Minor |

```rust
// Major: prevents struct literal construction
pub struct Foo { pub f1: i32 }    // before
pub struct Foo { pub f1: i32, pub f2: i32 }  // after — breaks Foo { f1: 1 }
```

**Mitigation**: Use `#[non_exhaustive]` on structs from the start to prevent external struct literal construction.

## Enums

| Change | Classification |
|--------|---------------|
| Adding a variant (without `#[non_exhaustive]`) | **Major** |
| Adding fields to a variant | **Major** |

```rust
// Major: breaks exhaustive match
pub enum E { A }         // before
pub enum E { A, B }      // after — breaks match e { E::A => {} }
```

**Mitigation**: Use `#[non_exhaustive]` on enums to require `_ =>` wildcard patterns.

## Traits

| Change | Classification |
|--------|---------------|
| Adding a non-defaulted method | **Major** |
| Changing method signatures | **Major** |
| Making a trait non-object-safe | **Major** |
| Adding a type parameter without default | **Major** |
| Adding a defaulted method | Possibly breaking |
| Adding a defaulted type parameter | Minor |
| Loosening trait bounds | Minor |
| Tightening trait bounds | **Major** |

```rust
// Major: implementors must implement new method
pub trait Trait { fn foo(&self); }  // added non-defaulted method
```

## Generics

| Change | Classification |
|--------|---------------|
| Tightening generic bounds | **Major** |
| Loosening generic bounds | Minor |
| Adding defaulted type parameters | Minor |
| Adding non-defaulted type parameters | **Major** |

## Type Layout and `repr`

| Change | Classification |
|--------|---------------|
| Adding `#[repr(packed)]` | **Major** |
| Adding `#[repr(align(N))]` | **Major** |
| Removing `#[repr(C)]` | **Major** |
| Adding `#[repr(C)]` (was default repr) | Minor |
| Adding `#[repr(<int>)]` to enum | Minor |

## Functions

| Change | Classification |
|--------|---------------|
| Adding or removing parameters | **Major** |
| Making `unsafe` fn safe | Minor |
| Generalizing fn type (if original type still works) | Minor |
| Generalizing fn type (if original type no longer works) | **Major** |

## Tooling and Environment

| Change | Classification |
|--------|---------------|
| Increasing minimum Rust version (MSRV) | Possibly breaking |
| Switching from `no_std` to requiring `std` | **Major** |
| Adding `#[non_exhaustive]` to item with no private fields | **Major** |
| Introducing new warnings/lints | Minor |

## Cargo Features

| Change | Classification |
|--------|---------------|
| Adding a new feature | Minor |
| Adding an optional dependency | Minor |
| Removing a feature | **Major** |
| Removing an optional dependency (if exposed as feature) | **Major** |
| Moving public code behind a feature | **Major** |
| Removing a feature from `default` | **Major** |
| Changing dependency feature flags (reducing) | Minor |
| Adding new dependencies | Minor |

## Practical Guidelines

- Use `#[non_exhaustive]` on public structs and enums from the start if you anticipate adding fields/variants.
- Use `pub(crate)` or private fields to allow future additions without major bumps.
- Document your MSRV with `rust-version` in `Cargo.toml`.
- The "semver trick" — for a point release that breaks a type: publish the old version re-exporting the new type — allows both versions to coexist.

## Related

- [reference-specifying-dependencies.md](./reference-specifying-dependencies.md)
- [reference-resolver.md](./reference-resolver.md)
- [reference-features.md](./reference-features.md)
- [reference-publishing.md](./reference-publishing.md)
