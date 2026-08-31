# Attributes

The `#[doc]` attribute controls how rustdoc generates documentation. `///` is syntax sugar for `#[doc = "..."]` and `//!` is sugar for `#![doc = "..."]`.

## Signature / Usage

```rust
// These two forms are equivalent
/// This is a doc comment.
#[doc = r" This is a doc comment."]
fn f() {}

// Include an external file
#[doc = include_str!("../../README.md")]
pub struct MyStruct;
```

## Crate-Level Attributes

Applied with `#![doc(...)]` at the crate root.

| Attribute | Description |
|-----------|-------------|
| `html_favicon_url = "URL"` | Sets the favicon for generated docs |
| `html_logo_url = "URL"` | Sets the logo in the upper-left of docs |
| `html_playground_url = "URL"` | Base URL for "Run" buttons on examples |
| `issue_tracker_base_url = "URL"` | Prefix for unstable feature tracking issue links |
| `html_root_url = "URL"` | Base URL for generating links to this crate from other crates |
| `html_no_source` | Excludes source code from generated docs |
| `test(no_crate_inject)` | Prevents automatic `extern crate` injection in doctests |
| `test(attr(...))` | Adds attributes to all doctests in the crate |

```rust
#![doc(html_favicon_url = "https://example.com/favicon.ico")]
#![doc(html_logo_url = "https://example.com/logo.jpg")]
#![doc(html_root_url = "https://docs.rs/mycrate/1.0")]
#![doc(test(attr(deny(dead_code))))]
```

## Item-Level Attributes

Applied with `#[doc(...)]` on individual items.

### `inline` and `no_inline`

Control how re-exported items appear.

```rust
// Inline: Bar appears in the Structs section as if defined here
#[doc(inline)]
pub use bar::Bar;

// No-inline: shows "Re-exports" link without inlining
#[doc(no_inline)]
pub use bar::Bar;
```

### `hidden`

Excludes an item from documentation (still accessible via `--document-hidden-items`).

```rust
#[doc(hidden)]
pub struct InternalHelper;
```

### `alias`

Adds search index aliases so users can find items under alternative names.

```rust
#[doc(alias = "TheAlias")]
#[doc(alias("another_name", "yet_another"))]
pub struct SomeType;

// FFI use case: find Rust wrapper by C function name
impl Obj {
    #[doc(alias = "lib_name_do_something")]
    pub fn do_something(&mut self) -> i32 { /* ... */ }
}
```

### `test(attr(...))`

Overrides or extends doctest attributes for a specific module.

```rust
// Crate-level: deny dead_code in all doctests
#![doc(test(attr(deny(dead_code))))]

mod my_mod {
    // Module-level: allow dead_code (appended, not replaced)
    #![doc(test(attr(allow(dead_code))))]
}
```

## Notes

- Rustdoc resolves `html_root_url` as: local docs → `--extern-html-root-url` flag → `html_root_url` attribute → no link.
- `#[doc(hidden)]` items are still compiled; they just don't appear in the generated HTML unless `--document-hidden-items` is passed.
- `alias` values cannot contain quotes or leading/trailing whitespace.

## Related

- [How to write documentation](./how-to-write.md)
- [Advanced features](./advanced-features.md)
- [Unstable features](./unstable-features.md)
