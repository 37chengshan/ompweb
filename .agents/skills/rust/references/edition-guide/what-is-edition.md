# What are Editions?

Editions are Rust's mechanism for introducing backwards-incompatible changes while preserving stability guarantees. Each crate opts in independently by setting `edition` in `Cargo.toml`.

## Signature / Usage

```toml
[package]
name = "my-crate"
version = "0.1.0"
edition = "2021"
```

Valid values: `"2015"`, `"2018"`, `"2021"`, `"2024"`.

## How Editions Work

- **Opt-in**: Existing crates are unaffected until they explicitly update their `Cargo.toml`.
- **Backwards incompatible changes are bundled** into the next edition rather than released as breaking minor/patch changes.
- **All editions compile to the same internal representation**. The changes are "skin deep" (syntax and name resolution), so crates compiled under different editions interoperate freely.
- **`cargo new` always selects the latest stable edition** for new projects.

## Ecosystem Compatibility

Crates in one edition seamlessly interoperate with those compiled in another edition. The edition choice is private to each crate and does not affect its public API or ABI.

## Automated Migration

```bash
cargo fix --edition
```

`cargo fix` rewrites source code to be compatible with the target edition. For example, when migrating to Rust 2018 a variable named `async` is rewritten to the raw identifier `r#async`.

Some corner cases cannot be automated and require manual changes. If `cargo fix` cannot fix something it emits a warning.

## Notes

- Code written before explicit edition support was added is treated as Rust 2015.
- The edition field only affects the crate it appears in; it does not propagate to dependencies.
- New keywords introduced in later editions (e.g., `async`, `gen`) can conflict with identifiers in older code; raw identifiers (`r#ident`) are the escape hatch.

## Related

- [Creating a new project](./creating-new-project.md)
- [Transitioning an existing project](./transitioning-existing-project.md)
- [Rust 2015](./rust-2015.md)
- [Rust 2018](./rust-2018.md)
- [Rust 2021](./rust-2021.md)
- [Rust 2024](./rust-2024.md)
