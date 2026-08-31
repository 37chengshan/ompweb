# Chapter 11: Writing Automated Tests

Rust's built-in testing framework: test functions, assertion macros, and test organization.

## Writing Test Functions

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn it_works() {
        let result = add(2, 2);
        assert_eq!(result, 4);
    }

    #[test]
    fn larger_can_hold_smaller() {
        let larger = Rectangle { width: 8, height: 7 };
        let smaller = Rectangle { width: 5, height: 1 };
        assert!(larger.can_hold(&smaller));
    }

    #[test]
    fn greeting_contains_name() {
        let result = greeting("Carol");
        assert!(
            result.contains("Carol"),
            "Greeting was `{result}`"  // custom failure message
        );
    }

    #[test]
    #[should_panic(expected = "less than or equal to 100")]
    fn greater_than_100() {
        Guess::new(200); // must panic with message containing expected string
    }

    #[test]
    fn it_works_result() -> Result<(), String> {
        if add(2, 2) == 4 { Ok(()) } else { Err(String::from("wrong")) }
    }
}
```

### Assertion macros

| Macro | Use |
|-------|-----|
| `assert!(expr)` | Passes if `expr` is `true` |
| `assert_eq!(left, right)` | Passes if equal; prints both on failure |
| `assert_ne!(left, right)` | Passes if not equal |
| `#[should_panic]` | Passes if code panics |

- `assert_eq!` / `assert_ne!` require `PartialEq` and `Debug` on the values.
- Custom messages are formatted strings after the assertion arguments.

## Running Tests

```bash
cargo test                      # run all tests
cargo test one_hundred          # run tests matching "one_hundred"
cargo test add                  # run tests whose name contains "add"
cargo test -- --test-threads=1  # sequential (no parallelism)
cargo test -- --show-output     # show stdout from passing tests
cargo test -- --ignored         # run only #[ignore] tests
cargo test -- --include-ignored # run all including ignored
```

```rust
#[test]
#[ignore]
fn expensive_test() { /* skipped by default */ }
```

## Test Organization

### Unit tests — same file as code

```rust
// src/lib.rs
pub fn add_two(x: i32) -> i32 { x + 2 }

#[cfg(test)]          // compiled only with `cargo test`
mod tests {
    use super::*;     // can test private functions
    #[test]
    fn test_add_two() { assert_eq!(4, add_two(2)); }
}
```

### Integration tests — separate `tests/` directory

```rust
// tests/integration_test.rs
use adder::add_two;   // public API only

#[test]
fn it_adds_two() {
    assert_eq!(4, add_two(2));
}
```

Shared test helpers — use a subdirectory to avoid them appearing as test suites:

```
tests/
├── common/
│   └── mod.rs      // shared setup; not treated as a test file
└── integration_test.rs
```

## Notes

- `#[cfg(test)]` ensures test code is excluded from production builds.
- `Result`-returning tests can use `?` but cannot use `#[should_panic]`.
- Binary-only crates (`src/main.rs` without `src/lib.rs`) cannot have integration tests — move logic to `lib.rs`.
- Tests in the same file can access private functions via `use super::*`.

## Related

- [Chapter 9: Error Handling](./09-error-handling.md)
- [Chapter 12: I/O Project](./12-io-project.md)
