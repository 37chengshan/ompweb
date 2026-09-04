# Testing

Write unit tests inline with source code and integration tests in a separate `tests/` directory.

```rust
// src/lib.rs

pub fn add_two(x: i32) -> i32 { x + 2 }

pub fn divide(a: f64, b: f64) -> Result<f64, String> {
    if b == 0.0 { Err(String::from("division by zero")) }
    else { Ok(a / b) }
}

pub struct Guess(i32);
impl Guess {
    pub fn new(value: i32) -> Self {
        if !(1..=100).contains(&value) {
            panic!("Guess must be 1–100, got {value}");
        }
        Self(value)
    }
}

#[cfg(test)] // compiled only during `cargo test`
mod tests {
    use super::*;

    #[test]
    fn add_two_works() {
        assert_eq!(add_two(2), 4);
    }

    #[test]
    fn divide_ok() -> Result<(), String> {
        let r = divide(10.0, 2.0)?; // ? works in Result-returning tests
        assert_eq!(r, 5.0);
        Ok(())
    }

    #[test]
    fn divide_by_zero_is_err() {
        assert!(divide(1.0, 0.0).is_err());
    }

    #[test]
    #[should_panic(expected = "Guess must be 1–100")]
    fn guess_out_of_range_panics() {
        Guess::new(200);
    }

    #[test]
    fn custom_message_on_failure() {
        let result = add_two(3);
        assert!(
            result == 5,
            "expected 5, got {result}" // message shown only on failure
        );
    }

    #[test]
    #[ignore] // skipped by default; run with `cargo test -- --ignored`
    fn expensive_test() {
        // simulate slow computation
    }
}
```

```rust
// tests/integration_test.rs — tests the public API only
use my_crate::add_two;

#[test]
fn integration_add_two() {
    assert_eq!(add_two(10), 12);
}
```

```bash
cargo test                       # run all tests
cargo test add                   # run tests whose name contains "add"
cargo test -- --show-output      # show println! output from passing tests
cargo test -- --test-threads=1   # run sequentially
```

## Notes

- `#[cfg(test)]` excludes test code from production builds.
- Unit tests in the same file can access private functions via `use super::*`.
- Integration tests in `tests/` only access the public API; place shared helpers in `tests/common/mod.rs`.
- `Result`-returning tests support `?` but cannot use `#[should_panic]`.
