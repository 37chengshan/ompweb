# Error Handling

Rust distinguishes recoverable errors (`Result<T, E>`) from unrecoverable ones (`panic!`). The `Option<T>` type handles values that may be absent. The `?` operator propagates errors concisely.

## panic!

```rust
fn main() {
    // Unrecoverable — terminates the thread
    panic!("something went terribly wrong");
}
```

Use for truly unrecoverable situations, prototype code, or tests.

## Option

```rust
fn divide(a: f64, b: f64) -> Option<f64> {
    if b == 0.0 { None } else { Some(a / b) }
}

fn main() {
    match divide(4.0, 2.0) {
        Some(v) => println!("{}", v),
        None    => println!("cannot divide by zero"),
    }

    // Combinators
    let doubled = divide(4.0, 2.0).map(|v| v * 2.0);
    let val = divide(4.0, 0.0).unwrap_or(0.0);
    let val = divide(4.0, 2.0).expect("division failed"); // panics with message on None
}
```

## Result

```rust
use std::num::ParseIntError;

fn parse_and_double(s: &str) -> Result<i32, ParseIntError> {
    let n = s.parse::<i32>()?; // `?` returns Err early if parse fails
    Ok(n * 2)
}

fn main() {
    match parse_and_double("5") {
        Ok(v)  => println!("{}", v),    // 10
        Err(e) => println!("Error: {}", e),
    }
}
```

## The ? Operator

`?` unwraps `Ok` or returns the `Err` early. Works in functions returning `Result` or `Option`.

```rust
use std::fs;
use std::io;

fn read_file(path: &str) -> Result<String, io::Error> {
    let content = fs::read_to_string(path)?; // propagate io::Error
    Ok(content)
}
```

## Box\<dyn Error\> — Multiple Error Types

```rust
use std::error::Error;
use std::num::ParseIntError;

fn double_first(vec: &[&str]) -> Result<i32, Box<dyn Error>> {
    let first = vec.first().ok_or("vector is empty")?;
    let n = first.parse::<i32>()?;
    Ok(2 * n)
}
```

## Defining Custom Error Types

```rust
use std::fmt;

#[derive(Debug)]
enum AppError {
    NotFound(String),
    ParseError(String),
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            AppError::NotFound(s)  => write!(f, "not found: {}", s),
            AppError::ParseError(s) => write!(f, "parse error: {}", s),
        }
    }
}

impl std::error::Error for AppError {}
```

## Iterating over Results

```rust
fn main() {
    let strings = vec!["1", "two", "3"];

    // Collect successes and ignore failures
    let numbers: Vec<i32> = strings.iter()
        .filter_map(|s| s.parse().ok())
        .collect();
    println!("{:?}", numbers); // [1, 3]

    // Fail on first error
    let result: Result<Vec<i32>, _> = strings.iter()
        .map(|s| s.parse::<i32>())
        .collect();
}
```

## Notes

- Prefer `Result` over `panic!` in library code; let callers decide how to handle errors.
- `unwrap()` and `expect()` panic on `Err`/`None` — acceptable in tests and prototypes.
- Use the `thiserror` crate to derive `Error` implementations ergonomically.
- Use the `anyhow` crate for easy `Box<dyn Error>` equivalents in application code.

## Related

- [08-flow-of-control.md](./08-flow-of-control.md)
- [19-std-library-types.md](./19-std-library-types.md)
