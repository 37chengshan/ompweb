# Lints

Rustdoc provides lints to catch documentation quality issues. They are namespaced under `rustdoc::` and can be controlled with `#![allow]`, `#![warn]`, or `#![deny]`.

## Signature / Usage

```rust
#![deny(rustdoc::broken_intra_doc_links)]
#![warn(rustdoc::missing_docs)]
```

## Lint Reference

| Lint | Default | Description |
|------|---------|-------------|
| `rustdoc::broken_intra_doc_links` | warn | Intra-doc link that cannot be resolved or is ambiguous |
| `rustdoc::private_intra_doc_links` | warn | Public item links to a private item |
| `missing_docs` | allow | Public item has no documentation |
| `rustdoc::missing_crate_level_docs` | allow | No doc comment at the crate root |
| `rustdoc::missing_doc_code_examples` | allow | Documented item has no code example (nightly only) |
| `rustdoc::private_doc_tests` | allow | Doc test on a private item |
| `rustdoc::invalid_codeblock_attributes` | warn | Likely mis-typed code block attribute (e.g., `should-panic` instead of `should_panic`) |
| `rustdoc::invalid_html_tags` | warn | Unclosed or invalid HTML tag |
| `rustdoc::invalid_rust_codeblocks` | warn | Empty or unparsable Rust code block |
| `rustdoc::bare_urls` | warn | URL not formatted as a Markdown link |
| `rustdoc::unescaped_backticks` | allow | Backtick that likely indicates a broken inline code span |
| `rustdoc::redundant_explicit_links` | warn | Explicit link identical to the auto-generated intra-doc link |

## Examples

```rust
// broken_intra_doc_links — links to nonexistent item
/// See [`Nonexistent`].
pub fn foo() {}

// invalid_codeblock_attributes — hyphen instead of underscore
/// ```should-panic
/// assert!(false);
/// ```
pub fn bar() {}

// bare_urls — URL not wrapped in angle brackets or Markdown link
/// See http://example.org for details.
pub fn baz() {}

// missing_docs — enable to enforce full coverage
#![warn(missing_docs)]
pub fn undocumented() {}
```

## Notes

- `missing_docs` is from `rustc`, not rustdoc; the others are rustdoc-specific.
- `rustdoc::missing_doc_code_examples` is nightly-only.
- Use `#[allow(rustdoc::missing_docs)]` on individual items to suppress selectively.

## Related

- [Linking to items by name](./linking-to-items-by-name.md)
- [Documentation tests](./documentation-tests.md)
