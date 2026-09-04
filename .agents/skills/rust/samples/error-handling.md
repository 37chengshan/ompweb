# Error Handling

Use `Result<T, E>` and the `?` operator to propagate recoverable errors without nested `match`.

```rust
use std::fs::File;
use std::io::{self, Read};

// ? propagates Err early; Ok value continues
fn read_username_from_file() -> Result<String, io::Error> {
    let mut username = String::new();
    File::open("hello.txt")?.read_to_string(&mut username)?;
    Ok(username)
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    // expect: panics with a descriptive message (preferred over unwrap)
    let content = std::fs::read_to_string("hello.txt")
        .expect("Failed to read hello.txt");

    // match: handle specific error kinds
    match File::open("config.toml") {
        Ok(f) => println!("opened: {f:?}"),
        Err(e) if e.kind() == io::ErrorKind::NotFound => {
            println!("config.toml not found; using defaults");
        }
        Err(e) => return Err(e.into()),
    }

    // Propagate with ? in main (Box<dyn Error> accepts any error type)
    let username = read_username_from_file()?;
    println!("username: {username}");
    Ok(())
}
```

## Notes

- `?` converts the error type via `From` automatically and returns early on `Err`.
- Use `expect("context message")` rather than bare `unwrap()` so panics are diagnosable.
- `Box<dyn std::error::Error>` in `main` is a convenient catch-all for mixed error types.
- Return `Result` whenever the caller should decide how to handle failure; use `panic!` only for unrecoverable bugs.
