# Attributes

An attribute is metadata applied to a crate, module, or item. Outer attributes (`#[...]`) apply to the next item; inner attributes (`#![...]`) apply to the enclosing item (typically the whole crate/module).

## Syntax

```rust
#[attribute]
#[attribute = "value"]
#[attribute(key = "value")]
#[attribute(value1, value2)]
```

## Common Attributes

### dead_code — suppress unused warnings

```rust
#[allow(dead_code)]
fn unused_fn() {}
```

### derive — auto-implement standard traits

```rust
#[derive(Debug, Clone, PartialEq)]
struct Point { x: f64, y: f64 }

fn main() {
    let p = Point { x: 1.0, y: 2.0 };
    println!("{:?}", p);            // Debug
    let q = p.clone();              // Clone
    assert_eq!(p, q);               // PartialEq
}
```

### cfg — conditional compilation

```rust
#[cfg(target_os = "linux")]
fn linux_only() { println!("running on Linux"); }

#[cfg(feature = "my_feature")]
fn feature_gated() {}

fn main() {
    #[cfg(debug_assertions)]
    println!("debug build");
}
```

### crate-level attributes

```rust
// lib.rs
#![crate_name = "my_lib"]
#![crate_type = "lib"]
#![allow(unused_variables)]
```

## Notes

- `#[test]` marks a function as a unit test.
- `#[inline]` / `#[inline(always)]` hint the compiler to inline a function.
- `#[must_use]` causes a compiler warning if the return value is ignored.
- Custom `cfg` flags: pass `-C --cfg 'flag'` to `rustc` or use `[features]` in `Cargo.toml`.
- Procedural macros can define custom attributes (e.g., `#[derive(Serialize)]` from `serde`).

## Related

- [17-macros.md](./17-macros.md)
- [21-testing.md](./21-testing.md)
