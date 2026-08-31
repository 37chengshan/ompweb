# Chapter 6: Enums and Pattern Matching

Enumerations express a value that can be one of several variants. Combined with `match`, they enable exhaustive, type-safe control flow.

## Defining Enums

```rust
// Basic enum
enum Direction { North, South, East, West }
let go = Direction::North;

// Variants with associated data
enum Message {
    Quit,                       // no data
    Move { x: i32, y: i32 },   // named fields
    Write(String),              // single value
    ChangeColor(i32, i32, i32), // multiple values
}

impl Message {
    fn call(&self) { /* ... */ }
}

let m = Message::Write(String::from("hello"));
m.call();
```

## Option\<T\>

Rust's type-safe replacement for null:

```rust
enum Option<T> {
    Some(T),
    None,
}

let some_number: Option<i32> = Some(5);
let absent: Option<i32> = None;
```

`Option<T>` and `T` are **different types** — you cannot use an `Option<i32>` where an `i32` is expected without explicitly handling both cases.

## match Expression

```rust
fn value_in_cents(coin: Coin) -> u8 {
    match coin {
        Coin::Penny => 1,
        Coin::Nickel => 5,
        Coin::Dime => 10,
        Coin::Quarter => 25,
    }
}

// Binding values from variants
match coin {
    Coin::Quarter(state) => println!("State: {state:?}"),
    other => println!("Other coin"),
}

// Matching Option<T>
fn plus_one(x: Option<i32>) -> Option<i32> {
    match x {
        None => None,
        Some(i) => Some(i + 1),
    }
}
```

### Catch-all patterns

```rust
match dice_roll {
    3 => add_fancy_hat(),
    7 => remove_fancy_hat(),
    other => move_player(other), // binds value
    // or: _ => reroll(),        // ignores value
    // or: _ => (),              // do nothing
}
```

- `match` is **exhaustive**: all cases must be covered or the code won't compile.
- Catch-all arms must be **last**.

## if let and let...else

```rust
// Concise single-pattern matching
if let Some(max) = config_max {
    println!("Max is {max}");
}

// With else
if let Coin::Quarter(state) = coin {
    println!("Quarter from {state:?}");
} else {
    count += 1;
}

// let...else: bind or return early (stays on happy path)
let Coin::Quarter(state) = coin else {
    return None;
};
```

## Notes

- `if let` and `let...else` sacrifice exhaustive checking for conciseness.
- Use `match` when you need to verify all variants are handled.
- Enum variants with data act like constructor functions.

## Related

- [Chapter 5: Using Structs](./05-structs.md)
- [Chapter 7: Packages, Crates, and Modules](./07-packages-crates-modules.md)
- [Chapter 19: Patterns and Matching](./19-patterns-and-matching.md)
