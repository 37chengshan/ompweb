# Chapter 19: Patterns and Matching

Patterns are a special syntax for matching against the structure of types. They appear throughout Rust and enable expressive, type-safe deconstruction.

## Where Patterns Appear

```rust
// match arms
match value {
    Pattern1 => expression1,
    Pattern2 => expression2,
}

// if let
if let Some(x) = optional { use(x); }

// while let
while let Ok(val) = rx.recv() { process(val); }

// for loops (variable after `for` is a pattern)
for (index, value) in v.iter().enumerate() { }

// let statements
let (x, y, z) = (1, 2, 3);

// function parameters
fn print_point(&(x, y): &(i32, i32)) { println!("({x}, {y})"); }
```

## Pattern Syntax

### Literals and named variables

```rust
match x {
    1 => println!("one"),
    2 | 3 => println!("two or three"),     // multiple patterns
    1..=5 => println!("one through five"), // inclusive range
    _ => println!("other"),               // wildcard
}
```

**Note**: named variables in `match`/`if let` create new bindings that shadow outer variables. Use match guards to compare against outer values.

### Destructuring structs

```rust
struct Point { x: i32, y: i32 }
let Point { x, y } = p;        // shorthand

match p {
    Point { x, y: 0 } => println!("on x-axis at {x}"),
    Point { x: 0, y } => println!("on y-axis at {y}"),
    Point { x, y }    => println!("({x}, {y})"),
}
```

### Destructuring enums

```rust
enum Message {
    Quit,
    Move { x: i32, y: i32 },
    Write(String),
    ChangeColor(i32, i32, i32),
}

match msg {
    Message::Quit               => quit(),
    Message::Move { x, y }     => move_to(x, y),
    Message::Write(text)        => println!("{text}"),
    Message::ChangeColor(r,g,b) => change(r, g, b),
}
```

### Ignoring values

```rust
fn foo(_: i32, y: i32) {}  // ignore entire parameter

match (a, b) {
    (Some(_), Some(_)) => println!("both some"),  // ignore inner values
    _ => (),
}

let Point { x, .. } = p;        // ignore remaining fields with ..
let (first, .., last) = (1,2,3,4,5); // ignore middle
```

- `_` does not bind — no ownership transfer.
- `_x` binds but suppresses the unused warning.

### Match guards

```rust
let num = Some(4);
match num {
    Some(x) if x % 2 == 0 => println!("even: {x}"),
    Some(x)                => println!("odd: {x}"),
    None                   => (),
}

// Guards solve the shadowing problem (compare against outer variable)
let y = 10;
match x {
    Some(n) if n == y => println!("matched outer y"),
    _                 => println!("no match"),
}
```

Guards apply to all patterns when using `|`:
```rust
match x {
    4 | 5 | 6 if condition => println!("yes"), // condition applies to all three
    _ => (),
}
```

### @ bindings — bind while testing

```rust
match msg {
    Message::Hello { id: id @ 3..=7 } => println!("id in range: {id}"),
    Message::Hello { id: 10..=12 }    => println!("another range, id not bound"),
    Message::Hello { id }             => println!("id: {id}"),
}
```

## Refutable vs. Irrefutable Patterns

| Type | Description | Use in |
|------|-------------|--------|
| Irrefutable | Always match (e.g., `let x = 5`) | `let`, function params, `for` |
| Refutable | May not match (e.g., `Some(x)`) | `if let`, `while let`, `match` arms |

Using a refutable pattern in `let` is a compile error; using an irrefutable pattern in `if let` generates a warning.

## Notes

- `match` is **exhaustive** — all possible values must be covered.
- Ranges in patterns (`1..=5`) work only with numeric and `char` types.
- The compiler warns when a pattern is unreachable (e.g., after a wildcard arm).
- Patterns can be nested arbitrarily deep for destructuring complex data.

## Related

- [Chapter 6: Enums and Pattern Matching](./06-enums-and-pattern-matching.md)
- [Chapter 18: OOP Features](./18-oop.md)
