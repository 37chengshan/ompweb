# Chapter 2: Programming a Guessing Game

A hands-on introduction to Rust fundamentals through building a complete number-guessing game. Covers variables, I/O, external crates, pattern matching, and control flow.

## Key Concepts

### Full example

```rust
use std::cmp::Ordering;
use std::io;
use rand::Rng;

fn main() {
    println!("Guess the number!");

    let secret_number = rand::thread_rng().gen_range(1..=100);

    loop {
        println!("Please input your guess.");

        let mut guess = String::new();

        io::stdin()
            .read_line(&mut guess)
            .expect("Failed to read line");

        let guess: u32 = match guess.trim().parse() {
            Ok(num) => num,
            Err(_) => continue,
        };

        println!("You guessed: {guess}");

        match guess.cmp(&secret_number) {
            Ordering::Less => println!("Too small!"),
            Ordering::Greater => println!("Too big!"),
            Ordering::Equal => {
                println!("You win!");
                break;
            }
        }
    }
}
```

Add the `rand` dependency in `Cargo.toml`:

```toml
[dependencies]
rand = "0.8.5"
```

### Concepts demonstrated

| Concept | Example |
|---------|---------|
| Immutable variable | `let secret_number = ...` |
| Mutable variable | `let mut guess = String::new()` |
| Reading stdin | `io::stdin().read_line(&mut guess)` |
| Shadowing (type change) | `let guess: u32 = guess.trim().parse()...` |
| Pattern matching | `match guess.cmp(&secret_number) { ... }` |
| Result handling | `.expect(...)` / `match Ok/Err` |
| Infinite loop with break | `loop { ... break; }` |

## Notes

- **Shadowing** lets you re-bind a variable with a different type using `let` again. This differs from `mut`, which cannot change the type.
- `read_line` returns `Result<usize, io::Error>`; calling `.expect()` panics with a message on `Err`.
- `parse()` returns a `Result`; using `match` handles invalid input gracefully with `continue`.
- `rand::thread_rng().gen_range(1..=100)` requires `use rand::Rng` for the trait's methods.
- `Cargo.lock` pins dependency versions; `cargo update` fetches compatible newer versions.
- SemVer `"0.8.5"` means `>=0.8.5, <0.9.0`.

## Related

- [Chapter 1: Getting Started](./01-getting-started.md)
- [Chapter 3: Common Programming Concepts](./03-common-programming-concepts.md)
