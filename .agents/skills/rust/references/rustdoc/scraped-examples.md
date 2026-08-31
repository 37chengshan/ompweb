# Scraped Examples

An unstable rustdoc feature that automatically extracts code examples from a Cargo workspace's `examples/` directory and embeds them in the relevant item documentation.

## Signature / Usage

```bash
# Local development
cargo doc -Zunstable-options -Zrustdoc-scrape-examples

# Manual two-step invocation
rustdoc examples/ex.rs -Z unstable-options \
  --extern foobar=target/deps/libfoobar.rmeta \
  --scrape-examples-target-crate foobar \
  --scrape-examples-output-path output.calls

rustdoc src/lib.rs -Z unstable-options --with-examples output.calls
```

## Enabling on docs.rs

```toml
# Cargo.toml
[package.metadata.docs.rs]
cargo-args = ["-Zunstable-options", "-Zrustdoc-scrape-examples"]
```

## How It Works

1. Rustdoc analyzes all crates matching Cargo's `--examples` filter.
2. It finds call sites and usages of documented items.
3. Source snippets are embedded into the item's documentation page.

### Display Behavior

| Property | Value |
|----------|-------|
| Max examples shown per item | 5 (extras are links only) |
| Default display | 1 example visible; others collapsed |
| Ordering | Smaller examples first |

## Notes

- Scraped examples are inserted by rustdoc and cannot be manually edited.
- Requires nightly and `-Zunstable-options`.
- If examples are not showing up, verify that `cargo check --examples` includes the example file (rustdoc uses Cargo's standard example discovery).
- Tracking issue: [#88791](https://github.com/rust-lang/rust/issues/88791)

## Related

- [Unstable features](./unstable-features.md)
- [Documentation tests](./documentation-tests.md)
