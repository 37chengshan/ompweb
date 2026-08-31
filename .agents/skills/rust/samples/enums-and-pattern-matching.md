# Enums and Pattern Matching

Model domain variants with `enum`, extract data exhaustively with `match`, and use `Option<T>` instead of null.

```rust
#[derive(Debug)]
enum Message {
    Quit,
    Move { x: i32, y: i32 },
    Write(String),
    ChangeColor(u8, u8, u8),
}

fn process(msg: Message) {
    match msg {
        Message::Quit => println!("quit"),
        Message::Move { x, y } => println!("move to ({x},{y})"),
        Message::Write(text) => println!("write: {text}"),
        Message::ChangeColor(r, g, b) => println!("color: {r},{g},{b}"),
    }
}

// Option<T>: type-safe alternative to null
fn divide(a: f64, b: f64) -> Option<f64> {
    if b == 0.0 { None } else { Some(a / b) }
}

fn main() {
    process(Message::Move { x: 10, y: 20 });
    process(Message::Write(String::from("hello")));

    // match on Option
    match divide(10.0, 3.0) {
        Some(result) => println!("result: {result:.2}"),
        None => println!("division by zero"),
    }

    // if let — concise single-pattern match
    if let Some(v) = divide(9.0, 3.0) {
        println!("got {v}");
    }

    // let...else — bind or return early
    let Some(v) = divide(4.0, 2.0) else {
        println!("failed");
        return;
    };
    println!("let-else result: {v}");

    // Catch-all with other / _
    let n = 7u32;
    match n {
        1 => println!("one"),
        2 | 3 => println!("two or three"),
        4..=6 => println!("four to six"),
        other => println!("other: {other}"),
    }
}
```

## Notes

- `match` is exhaustive — all variants must be covered or the code will not compile.
- `if let` and `let...else` are shorthand for single-pattern matches; they sacrifice exhaustiveness for conciseness.
- `Option<T>` and `T` are distinct types: an `Option<i32>` cannot be used where `i32` is expected without unwrapping.
- Enum variants can hold named fields, unnamed tuple values, or no data at all.
