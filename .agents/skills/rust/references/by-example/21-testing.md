# Testing

Rust has first-class support for three kinds of tests: **unit tests** (alongside code), **integration tests** (in `tests/`), and **doc tests** (in `///` comments). Run all tests with `cargo test`.

## Unit Tests

```rust
pub fn add(a: i32, b: i32) -> i32 { a + b }

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_add() {
        assert_eq!(add(1, 2), 3);
    }

    #[test]
    fn test_add_negative() {
        assert_ne!(add(-1, 1), 99);
    }

    #[test]
    #[should_panic(expected = "divide by zero")]
    fn test_panic() {
        let _ = 1 / 0;
    }

    #[test]
    #[ignore]
    fn expensive_test() {
        // run with: cargo test -- --ignored
    }

    // Tests can return Result
    #[test]
    fn test_with_result() -> Result<(), String> {
        if add(2, 2) == 4 { Ok(()) } else { Err("math is broken".into()) }
    }
}
```

## Assert Macros

| Macro | Description |
|-------|-------------|
| `assert!(expr)` | Panics if `expr` is false |
| `assert_eq!(a, b)` | Panics if `a != b` |
| `assert_ne!(a, b)` | Panics if `a == b` |

All accept an optional format message: `assert_eq!(a, b, "got {}", a)`.

## Integration Tests

Place in `tests/` directory — each file is a separate crate that imports your library:

```rust
// tests/integration_test.rs
use my_lib::add;

#[test]
fn test_add_from_outside() {
    assert_eq!(add(2, 3), 5);
}
```

Run a specific integration test file: `cargo test --test integration_test`.

## Doc Tests

Code blocks in `///` doc comments are compiled and run as tests:

```rust
/// Adds two numbers together.
///
/// # Examples
///
/// ```
/// assert_eq!(my_lib::add(1, 2), 3);
/// ```
pub fn add(a: i32, b: i32) -> i32 { a + b }
```

Run only doc tests: `cargo test --doc`.

## Dev Dependencies

Test-only dependencies go in `[dev-dependencies]` in `Cargo.toml`:

```toml
[dev-dependencies]
pretty_assertions = "1"
```

## Notes

- `#[cfg(test)]` ensures the `tests` module is only compiled for `cargo test`, not in the final binary.
- Run a specific test by name: `cargo test test_add`.
- Run tests in parallel by default; use `-- --test-threads=1` for sequential execution.
- `cargo test -- --nocapture` shows `println!` output from passing tests.

## Related

- [12-cargo.md](./12-cargo.md)
- [24-meta.md](./24-meta.md)
- [13-attributes.md](./13-attributes.md)
