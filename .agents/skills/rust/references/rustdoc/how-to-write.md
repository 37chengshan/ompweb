# How to Write Documentation

Rustdoc renders doc comments written with `///` (outer) or `//!` (inner) syntax. The content is parsed as **CommonMark Markdown** with extensions.

## Signature / Usage

```rust
//! Crate-level documentation using inner doc comments.
//! Appears on the crate index page.

/// Short one-line summary (used in search results and module overviews).
///
/// Longer description follows after a blank line.
///
/// # Examples
///
/// ```
/// use mycrate::my_fn;
/// my_fn();
/// ```
///
/// # Panics
///
/// Describe conditions that cause panics.
///
/// # Errors
///
/// Describe error conditions for `Result`-returning functions.
pub fn my_fn() {}
```

## Recommended Sections

| Section header | Purpose |
|----------------|---------|
| `# Examples` | Copy-paste ready code examples |
| `# Panics` | Conditions that cause panics |
| `# Errors` | Error variants returned |
| `# Safety` | Required invariants for `unsafe` code |

## Markdown Extensions

### Strikethrough
```markdown
~~removed~~ or ~also removed~
```

### Footnotes
```markdown
Text with a footnote[^1].

[^1]: The footnote content.
```

### Tables
```markdown
| Col1 | Col2 |
|------|------|
| a    | b    |
```

### Task Lists
```markdown
- [x] Done
- [ ] Not done
```

### Smart Punctuation
- `--` → en dash, `---` → em dash, `...` → ellipsis
- Straight quotes converted to curly quotes

### Warning Blocks
```rust
/// Normal text.
///
/// <div class="warning">
///
/// Warning message with [links](https://rust-lang.org) supported.
///
/// </div>
///
/// More normal text.
```

Empty lines between HTML tags and markdown content are required for correct parsing.

## Notes

- The first line before a blank line becomes the summary shown in search results and module listings — keep it to one sentence.
- If an item is public, it should be documented.
- Do not explicitly document types in prose; use intra-doc links instead.
- Use `#[doc = include_str!("../../README.md")]` to pull external files into documentation.

## Related

- [Attributes (`#[doc]`)](./attributes.md)
- [Documentation tests](./documentation-tests.md)
- [Linking to items by name](./linking-to-items-by-name.md)
