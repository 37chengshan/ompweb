# Advanced Features

Advanced rustdoc capabilities for platform-specific documentation, search customization, and type representation control.

## `#[cfg(doc)]`: Platform-Specific Documentation

Rustdoc respects `#[cfg(...)]` the same way the compiler does. Use `#[cfg(doc)]` to make items visible in documentation regardless of the compilation target.

```rust
/// Available on Windows only.
#[cfg(any(windows, doc))]
pub struct WindowsToken;

/// Available on Unix only.
#[cfg(any(unix, doc))]
pub struct UnixToken;
```

Both structs appear in docs on all platforms, but only compile on their respective OS.

**Note:** `#[cfg(doc)]` is **not** passed to doctests.

## `#[doc(alias)]`: Search Aliases

Add search index aliases so users can find items under alternative names.

```rust
#[doc(alias = "x")]
#[doc(alias = "big")]
pub struct BigX;

// Multiple aliases in one attribute
#[doc(alias("x", "big"))]
pub struct BigX;
```

**FFI use case:** Let users find Rust wrappers by the original C function name.

```rust
impl Obj {
    #[doc(alias = "lib_name_do_something")]
    pub fn do_something(&mut self) -> i32 { /* ... */ }
}
```

**Limitations:**
- Cannot contain quotes (`'`, `"`)
- Cannot have leading or trailing whitespace (internal ASCII spaces are allowed)

## Custom Search Engines

Use the rustdoc search URL as a browser custom search engine template:

```
# Search std docs
https://doc.rust-lang.org/stable/std/?search=%s

# Auto-navigate to first result
https://doc.rust-lang.org/stable/std/?search=%s&go_to_first=true
```

Add `go_to_first=true` to skip the results page and jump directly to the top match.

## `#[repr(...)]`: Representation in Docs

Rustdoc displays `#[repr(...)]` information subject to visibility rules:

- Shown only if **no** variants are `#[doc(hidden)]`
- Shown only if **all** fields are public and not `#[doc(hidden)]`

### `#[repr(transparent)]`

Displayed only if the non-1-ZST field is public and not hidden. If all fields are 1-ZST, at least one must be public and not hidden. There is no override mechanism to force rustdoc to show representation.

## Notes

- `#[cfg(doc)]` affects the documentation build but not doctests; doctests compile with normal cfg flags.
- `#[doc(alias)]` is distinct from `#[doc(inline)]`; aliases affect search only, not page layout.

## Related

- [Attributes (`#[doc]`)](./attributes.md)
- [Unstable features](./unstable-features.md)
- [Lints](./lints.md)
