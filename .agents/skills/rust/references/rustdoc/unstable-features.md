# Unstable Features

Unstable rustdoc features require a nightly compiler. Most command-line unstable features also require the `-Z unstable-options` flag.

## Enabling Unstable Features

```bash
# Command-line unstable flag example
rustdoc src/lib.rs -Z unstable-options --show-coverage

# Attribute unstable feature example
#![feature(doc_cfg)]
```

## Feature Reference

### `compile_fail` with Error Codes

Specify the expected error code in a failing doctest (used by the error index).

```rust
/// ```compile_fail,E0044
/// extern { fn some_func<T>(x: T); }
/// ```
pub fn f() {}
```

### `rustdoc::missing_doc_code_examples` Lint

Warn when documented items lack code examples.

```rust
#![deny(rustdoc::missing_doc_code_examples)]

/// No example here — triggers the lint.
pub fn no_example() {}
```

### `#[doc(notable_trait)]`

Marks a trait to appear in the "Notable traits" dialog in generated docs (used by `Iterator`, `Future`, `io::Read`, `io::Write` in std).

```rust
#![feature(doc_notable_trait)]

#[doc(notable_trait)]
pub trait MyTrait {}
```

Tracking issue: [#45040](https://github.com/rust-lang/rust/issues/45040)

### `#[doc(masked)]`

Hides internal dependency crates from documentation (used by the standard library).

```rust
#![feature(doc_masked)]

#[doc(masked)]
extern crate internal_crate;
```

### `#[doc(cfg(...))]` and `#[doc(auto_cfg)]`

Displays conditional compilation requirements in docs.

```rust
#![feature(doc_cfg)]

#[doc(cfg(feature = "futures-io"))]
pub mod futures {}
// Renders: "This is supported on feature="futures-io" only."
```

`auto_cfg` generates cfg annotations automatically without duplication.

### `--output-format json`

Outputs documentation as experimental JSON for tooling.

```bash
rustdoc src/lib.rs -Z unstable-options --output-format json

# Access std JSON docs
rustup component add --toolchain nightly rust-docs-json
```

Tracking issue: [#76578](https://github.com/rust-lang/rust/issues/76578)

### `--show-coverage`

Calculates and prints the percentage of documented items.

```bash
rustdoc src/lib.rs -Z unstable-options --show-coverage
```

Output: a table showing documented items and code example percentages per file.

Tracking issue: [#58154](https://github.com/rust-lang/rust/issues/58154)

### `--generate-link-to-definition`

Generates clickable links on types/identifiers in the source code view.

```bash
rustdoc src/lib.rs -Z unstable-options --generate-link-to-definition
```

Tracking issue: [#89095](https://github.com/rust-lang/rust/issues/89095)

### `--show-type-layout`

Adds a "Layout" section to type pages showing memory layout (size, alignment).

```bash
rustdoc src/lib.rs -Z unstable-options --show-type-layout
```

**Note:** Layout information is not guaranteed to be stable across compilations.

Tracking issue: [#113248](https://github.com/rust-lang/rust/issues/113248)

### `#[fundamental]`

Makes methods implemented through wrapper types (e.g., `Pin<&mut T>`) appear in the documentation of the wrapped type.

## Notes

- All `-Z unstable-options` features require a nightly compiler.
- Unstable attributes require the corresponding `#![feature(...)]` declaration.
- These features may change or be removed in any nightly release.

## Related

- [Scraped examples](./scraped-examples.md)
- [Command-line arguments](./command-line.md)
- [Advanced features](./advanced-features.md)
