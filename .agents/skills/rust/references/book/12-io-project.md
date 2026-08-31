# Chapter 12: An I/O Project — Building a Command Line Program

A practical project (minigrep) consolidating Chapters 1–11: reading CLI args, files, environment variables, stderr, and writing tests.

## Project Goal

Build `minigrep` — a simplified `grep` that searches a file for lines containing a query string.

```bash
cargo run -- searchterm file.txt
```

## Key Implementation Concepts

### Reading command-line arguments

```rust
use std::env;

fn main() {
    let args: Vec<String> = env::args().collect();
    // args[0] = program name, args[1] = query, args[2] = file path
    let query = &args[1];
    let file_path = &args[2];
}
```

- Use `env::args_os()` if arguments may contain invalid Unicode.

### Reading a file

```rust
use std::fs;

let contents = fs::read_to_string(file_path)
    .expect("Should have been able to read the file");
```

### Separation of concerns — Config struct

```rust
pub struct Config {
    pub query: String,
    pub file_path: String,
    pub ignore_case: bool,
}

impl Config {
    pub fn build(args: &[String]) -> Result<Config, &'static str> {
        if args.len() < 3 {
            return Err("not enough arguments");
        }
        Ok(Config {
            query: args[1].clone(),
            file_path: args[2].clone(),
            ignore_case: env::var("IGNORE_CASE").is_ok(),
        })
    }
}
```

### Library vs. binary split

- Business logic goes in `src/lib.rs` (testable).
- `src/main.rs` only parses args, calls `lib::run()`, and handles top-level errors.

```rust
// src/main.rs
fn main() {
    let args: Vec<String> = env::args().collect();
    let config = Config::build(&args).unwrap_or_else(|err| {
        eprintln!("Problem parsing arguments: {err}");
        process::exit(1);
    });
    if let Err(e) = minigrep::run(config) {
        eprintln!("Application error: {e}");
        process::exit(1);
    }
}
```

### Writing to stderr

```rust
eprintln!("Error: {err}"); // goes to stderr, not stdout
```

### Test-driven search function

```rust
pub fn search<'a>(query: &str, contents: &'a str) -> Vec<&'a str> {
    contents.lines()
        .filter(|line| line.contains(query))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn one_result() {
        let query = "duct";
        let contents = "Duct tape.\nSafe, fast, productive.";
        assert_eq!(vec!["Safe, fast, productive."], search(query, contents));
    }
}
```

### Case-insensitive variant

```rust
pub fn search_case_insensitive<'a>(query: &str, contents: &'a str) -> Vec<&'a str> {
    let query = query.to_lowercase();
    contents.lines()
        .filter(|line| line.to_lowercase().contains(&query))
        .collect()
}
```

## Notes

- This chapter practices refactoring toward clean code before introducing advanced features.
- `process::exit(1)` immediately terminates with a non-zero exit code (signals error to shell).
- `eprintln!` directs output to stderr; users can then pipe stdout without noise.
- The `IGNORE_CASE=1 cargo run` environment variable pattern is idiomatic for Unix CLI tools.
- Lifetimes on `search` are needed because the returned slices reference `contents`.

## Related

- [Chapter 9: Error Handling](./09-error-handling.md)
- [Chapter 11: Testing](./11-testing.md)
- [Chapter 13: Iterators and Closures](./13-iterators-closures.md)
