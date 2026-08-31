# Chapter 9: Error Handling

Rust distinguishes recoverable errors (`Result<T, E>`) from unrecoverable ones (`panic!`), requiring explicit acknowledgment at compile time.

## Unrecoverable Errors — panic!

```rust
panic!("crash and burn");

// Out-of-bounds access also panics
let v = vec![1, 2, 3];
v[99]; // thread 'main' panicked: index out of bounds

// Get a backtrace
RUST_BACKTRACE=1 cargo run
```

By default, panic **unwinds** the stack. For smaller binaries, configure to abort:

```toml
[profile.release]
panic = 'abort'
```

## Recoverable Errors — Result\<T, E\>

```rust
enum Result<T, E> {
    Ok(T),
    Err(E),
}
```

### Handling Result

```rust
use std::fs::File;
use std::io::ErrorKind;

let f = match File::open("hello.txt") {
    Ok(file) => file,
    Err(e) => match e.kind() {
        ErrorKind::NotFound => File::create("hello.txt").unwrap(),
        _ => panic!("Problem opening file: {e:?}"),
    },
};
```

### Shortcuts

```rust
// unwrap: returns Ok value or panics with default message
let f = File::open("hello.txt").unwrap();

// expect: panics with a custom message (preferred in production)
let f = File::open("hello.txt").expect("Failed to open hello.txt");
```

### Propagating errors with ?

```rust
use std::fs::File;
use std::io::{self, Read};

fn read_username_from_file() -> Result<String, io::Error> {
    let mut username = String::new();
    File::open("hello.txt")?.read_to_string(&mut username)?;
    Ok(username)
}
```

- `?` unwraps `Ok` and continues, or returns `Err` early to the caller.
- Converts error types using the `From` trait automatically.
- Can only be used in functions returning `Result`, `Option`, or types implementing `FromResidual`.

```rust
// Using ? in main
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let f = File::open("hello.txt")?;
    Ok(())
}
```

## When to panic vs. return Result

| Situation | Recommendation |
|-----------|---------------|
| Examples, prototypes, tests | `unwrap` / `expect` as placeholders |
| You've verified the logic succeeds | `expect` with explanation |
| Caller should decide how to handle | Return `Result` |
| Invalid/unexpected state (bug, not user error) | `panic!` |
| Expected occasional failures (wrong input, network) | Return `Result` |

Custom validation type pattern:

```rust
pub struct Guess {
    value: i32,
}
impl Guess {
    pub fn new(value: i32) -> Self {
        if value < 1 || value > 100 {
            panic!("Guess value must be less than or equal to 100, got {value}.");
        }
        Self { value }
    }
    pub fn value(&self) -> i32 { self.value }
}
```

## Notes

- There are **no exceptions** in Rust — only `Result` and `panic!`.
- Use `expect` over `unwrap` in production: the message aids debugging.
- `?` enables clean, linear error-propagation code without deeply nested `match`.
- `Box<dyn Error>` in `main` is a convenient trait object for any error type.

## Related

- [Chapter 6: Enums and Pattern Matching](./06-enums-and-pattern-matching.md)
- [Chapter 10: Generic Types, Traits, and Lifetimes](./10-generic-types-traits-lifetimes.md)
