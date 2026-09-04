# What is rustdoc?

Rustdoc is a documentation generator included in the standard Rust distribution. It takes a crate root or a standalone Markdown file as input and produces an HTML, CSS, and JavaScript website.

## Signature / Usage

```bash
# Generate docs from a source file
rustdoc src/lib.rs

# Override the crate name
rustdoc src/lib.rs --crate-name mycrate

# Generate and view with Cargo
cargo doc --open
```

## Key Concepts

### Outer vs Inner Documentation

```rust
/// Outer doc comment — documents the item below it
pub fn foo() {}

//! Inner doc comment — documents the enclosing module/crate
```

Use `//!` at the top of `lib.rs` for crate-level documentation.

### Output Structure

Running `rustdoc src/lib.rs --crate-name docs` produces:
- `doc/docs/index.html` — crate index page
- `doc/docs/fn.foo.html` — individual item pages

### Using with Cargo

Cargo calls rustdoc internally with the correct flags:

```bash
cargo doc               # Build docs into target/doc/
cargo doc --open        # Build and open in browser
```

Cargo passes `-o target/doc` and `-L dependency=target/debug/deps` automatically.

### Standalone Markdown Files

```bash
rustdoc README.md --markdown-css style.css
```

Produces `doc/README.html`. Note: Cargo does not support standalone Markdown files.

## Notes

- Only public items are documented by default; use `--document-private-items` to include private items.
- The crate name defaults to the filename (without `.rs`).
- Rustdoc only documents the crate root by default, not binaries.

## Related

- [Command-line arguments](./command-line.md)
- [How to write documentation](./how-to-write.md)
