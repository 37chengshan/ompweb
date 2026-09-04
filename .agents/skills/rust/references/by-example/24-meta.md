# Meta

Tooling for documentation and benchmarking: `rustdoc` generates HTML docs from source comments; Rust's built-in benchmark harness (nightly) measures performance.

## Documentation with rustdoc

### Doc Comments

Use `///` for item-level docs and `//!` for module/crate-level docs. Markdown is fully supported.

```rust
//! Crate-level documentation (inner attribute style).

/// A human being.
pub struct Person {
    /// The person's name.
    pub name: String,
}

impl Person {
    /// Creates a new [`Person`] with the given name.
    ///
    /// # Examples
    ///
    /// ```
    /// use my_crate::Person;
    /// let p = Person::new("Alice");
    /// assert_eq!(p.name, "Alice");
    /// ```
    pub fn new(name: &str) -> Self {
        Person { name: name.to_string() }
    }
}
```

### Generating Docs

```bash
cargo doc             # build docs into target/doc/
cargo doc --open      # build and open in browser
cargo doc --no-deps   # skip dependency docs
```

### Doc Attributes

```rust
#[doc(hidden)]           // exclude from docs
pub fn internal() {}

#[doc(inline)]           // inline re-exported item docs
pub use crate::detail::Foo;
```

### Hiding Doc Test Code

Use `#` prefix to hide setup lines while keeping them compiled:

```rust
/// ```
/// # fn setup() -> Vec<i32> { vec![1,2,3] }
/// # let v = setup();
/// assert_eq!(v.len(), 3);
/// ```
pub fn example() {}
```

## Benchmarking

The built-in `#[bench]` attribute requires **nightly** Rust and the `test` crate:

```rust
#![feature(test)]
extern crate test;

pub fn add(a: u64, b: u64) -> u64 { a + b }

#[cfg(test)]
mod benches {
    use super::*;
    use test::Bencher;

    #[bench]
    fn bench_add(b: &mut Bencher) {
        b.iter(|| add(2, 3));
    }
}
```

Run benchmarks:

```bash
cargo +nightly bench
```

For stable Rust benchmarking, use the [`criterion`](https://crates.io/crates/criterion) crate.

## Playground Integration

Embed interactive examples in docs using the Rust Playground URL:

```
https://play.rust-lang.org/?code=...
```

`rustdoc` automatically links code blocks to the Playground when generating docs on docs.rs.

## Notes

- `cargo test` also runs all doc tests — no separate step required.
- Doc tests verify that examples in documentation stay correct as code evolves.
- Use `criterion` for statistically rigorous benchmarking on stable Rust.
- `#[doc = "..."]` is the attribute form of doc comments (equivalent to `///`).

## Related

- [21-testing.md](./21-testing.md)
- [12-cargo.md](./12-cargo.md)
- [13-attributes.md](./13-attributes.md)
