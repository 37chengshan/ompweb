# Documentation Tests

Rustdoc executes code blocks in doc comments as tests. By default, all fenced code blocks without a language tag are treated as Rust and compiled.

## Signature / Usage

```bash
# Run doctests directly
rustdoc --test src/lib.rs

# Run via Cargo
cargo test --doc
```

```rust
/// Adds two numbers.
///
/// # Examples
///
/// ```
/// assert_eq!(2 + 2, 4);
/// ```
pub fn add(a: i32, b: i32) -> i32 { a + b }
```

## Code Block Attributes

Placed on the opening fence: ` ```attribute `.

| Attribute | Behavior |
|-----------|----------|
| `ignore` | Skip compilation and execution |
| `should_panic` | Compile and run; test passes if it panics |
| `no_run` | Compile but do not execute |
| `compile_fail` | Test passes only if compilation fails |
| `edition2015` / `edition2018` / `edition2021` / `edition2024` | Run with a specific Rust edition |
| `standalone_crate` | Do not merge with other doctests (useful for line-number assertions) |
| `ignore-<target>` | Skip on a specific target (e.g., `ignore-x86_64`, `ignore-windows`) |

```rust
/// ```should_panic
/// panic!("expected");
/// ```

/// ```no_run
/// loop { println!("runs forever"); }
/// ```

/// ```compile_fail
/// let x = 5;
/// x += 2; // error: cannot assign twice to immutable variable
/// ```

/// ```edition2021
/// let s = "hello";
/// println!("{s}");
/// ```
```

## Hiding Lines

Lines beginning with `#` are hidden in rendered docs but included in compilation.

```rust
/// ```
/// # fn setup() -> Vec<i32> { vec![1, 2, 3] }
/// let data = setup();
/// assert_eq!(data.len(), 3);
/// ```
```

Use `##` to display a literal `#` character.

## Preprocessing Applied to Doctests

Rustdoc automatically:
1. Inserts common `allow` attributes (`unused_variables`, `dead_code`, etc.)
2. Adds `extern crate <mycrate>;` unless `#![doc(test(no_crate_inject))]` is set
3. Wraps code without `fn main` in `fn main() { ... }`
4. Preserves leading `#![...]` crate-level attributes

## Using `?` in Doctests

```rust
/// ```
/// use std::io;
/// # fn main() -> io::Result<()> {
/// let mut s = String::new();
/// io::stdin().read_line(&mut s)?;
/// # Ok(())
/// # }
/// ```
```

Or with inline disambiguation (Rust 1.34+):

```rust
/// ```
/// use std::io;
/// io::stdin().read_line(&mut String::new())?;
/// # Ok::<(), io::Error>(())
/// ```
```

## Testing README as Doctests

```rust
#[doc = include_str!("../README.md")]
#[cfg(doctest)]
pub struct ReadmeDoctests;
```

## `#[cfg(doctest)]` for Test-Only Items

```rust
/// ```compile_fail
/// let x = mycrate::MyStruct(-5); // negative values rejected
/// ```
#[cfg(doctest)]
pub struct MyStructOnlyTakesUsize;
```

## Notes

- Use `cargo test --doc -- --show-output` to see test output including warnings.
- Indented code blocks (4+ spaces) are also compiled but cannot use attributes.
- `standalone_crate` prevents merging with other doctests, which affects line numbers.

## Related

- [How to write documentation](./how-to-write.md)
- [Lints](./lints.md)
- [Unstable features](./unstable-features.md)
