# Compatibility

Rust evolves rapidly while striving for backward compatibility. Editions and raw identifiers are the main tools for managing compatibility across Rust versions.

## Editions

Rust releases a new **edition** every three years (`2015`, `2018`, `2021`). An edition may introduce syntax-breaking changes, but Rust guarantees inter-edition compatibility within a project.

Set the edition in `Cargo.toml`:

```toml
[package]
name    = "my_crate"
edition = "2021"
```

## Raw Identifiers

Raw identifiers (`r#keyword`) allow using Rust keywords as identifiers. This is useful when:
- Calling code from an older edition that used a now-reserved keyword as a name.
- Interfacing with languages (e.g., C) that have identifiers conflicting with Rust keywords.

```rust
// `match` is a keyword, but r#match is allowed as an identifier
fn r#match(needle: &str, haystack: &str) -> bool {
    haystack.contains(needle)
}

fn main() {
    // r# prefix at call site too
    assert!(r#match("foo", "foobar"));

    // Variables using keyword names
    let r#type = "i32";
    let r#fn   = 42;
    println!("{} {}", r#type, r#fn);
}
```

## Edition Migration

```bash
# Automatically migrate code to a newer edition
cargo fix --edition
```

The tool applies mechanical fixes; manual review is still recommended afterward.

## Notes

- All crates in a workspace can use different editions independently.
- Keywords introduced in newer editions (e.g., `async`, `await` in 2018) become reserved; use raw identifiers to reference old code that used them as names.
- Rust maintains a **stability guarantee**: code that compiled on stable Rust will continue to compile on future stable versions.

## Related

- [12-cargo.md](./12-cargo.md)
