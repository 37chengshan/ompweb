# Linking to Items by Name

Rustdoc supports **intra-doc links** — links to other items in the documentation written as Rust paths, resolved at doc-generation time.

## Signature / Usage

```rust
/// See [`Vec`] for details.
/// Also see [`Vec::new`] and [`Option`].
/// Link with custom text: [the vector type](Vec).
pub fn example() {}
```

All of the following forms link to the same item:

```rust
/// [Bar]
/// [bar](Bar)
/// [`Bar`]
/// [bar][b]
/// [b]: Bar
```

Backticks are optional and stripped automatically (`` [`Option`] `` → link to `Option`).

## Valid Link Targets

- Any in-scope item by path (`Vec`, `std::vec::Vec`, `crate::my_mod::Foo`)
- `Self`, `self`, `super`, `crate` prefixes
- Associated items: `Vec::new`, `Iterator::Item`
- Items with generics: `` [`Vec<T>`] `` resolves to `Vec`
- All standard library primitives
- URL fragments: `[fmt params](std::fmt#formatting-parameters)`

**Not supported:**
- Blanket trait implementations
- Fully-qualified syntax (`<Vec as IntoIterator>::into_iter()`)

## Disambiguation

Rust has three namespaces (type, value, macro). Use a prefix when a name exists in multiple namespaces.

| Disambiguator | Applies to |
|---------------|-----------|
| `struct@`, `enum@`, `trait@`, `union@` | Types |
| `mod@`, `module@` | Modules |
| `fn@`, `function@`, `method@` | Functions / methods |
| `const@`, `constant@` | Constants |
| `field@`, `variant@` | Struct fields / enum variants |
| `derive@`, `macro@` | Macros |
| `type@`, `tyalias@`, `typealias@` | Type aliases |
| `prim@`, `primitive@` | Primitive types |

```rust
/// [`Foo`](struct@Foo)   — links to the struct
/// [`Foo`](fn@Foo)       — links to the function
/// [`foo!()`]            — links to the macro (parens/brackets also work)
```

## Scoping Rules

- Links resolve in the scope where the item is **defined**, not where it is re-exported.
- Additional documentation added on a re-export resolves in the **re-export scope**.
- `macro_rules!` links resolve relative to the crate root.

## Failed Link Behavior

| Syntax | Behavior when link cannot be resolved |
|--------|--------------------------------------|
| `[a]` | Displayed as literal `[a]` |
| `[b][c]` | Displayed as literal `[b][c]` |
| `[d](e)` | Converted to a link targeting `e` |
| `[f]` with `[f]: g` | Converted to a link targeting `g` |

Links containing `/` or `[]` characters are ignored entirely.

## Notes

- The `broken_intra_doc_links` lint (warn by default) catches unresolvable links.
- The `private_intra_doc_links` lint (warn by default) catches links from public to private items.
- When a name resolves to both a trait and a derive proc-macro, rustdoc automatically links to the trait.

## Related

- [Lints](./lints.md)
- [How to write documentation](./how-to-write.md)
