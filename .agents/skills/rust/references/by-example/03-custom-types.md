# Custom Types

Rust defines custom data types with `struct` (named fields, tuple structs, unit structs) and `enum` (C-like enums, enums with data). Constants are defined with `const` and `static`.

## Signature / Usage

```rust
// Named-field struct
struct Point {
    x: f64,
    y: f64,
}

// Tuple struct
struct Pair(i32, i32);

// Unit struct (no fields)
struct Unit;

// Enum with variants
#[derive(Debug)]
enum Direction {
    North,
    South,
    East,
    West,
}

// Enum carrying data
enum Message {
    Quit,
    Move { x: i32, y: i32 },
    Write(String),
    ChangeColor(i32, i32, i32),
}

// Constants
const MAX_POINTS: u32 = 100_000;
static LANGUAGE: &str = "Rust";

fn main() {
    let p = Point { x: 1.0, y: 2.0 };
    let pair = Pair(1, 2);

    // Destructure struct
    let Point { x, y } = p;

    let dir = Direction::North;
    println!("{:?}", dir);
}
```

## Notes

- `struct` update syntax (`..other_struct`) copies remaining fields from another instance.
- `enum` variants can be unit-like, tuple-like, or struct-like.
- `const`: compile-time constant, no fixed memory address.
- `static`: single memory location for program lifetime; `static mut` is unsafe.
- Use `#[derive(Debug)]` to enable `{:?}` printing.

## Related

- [08-flow-of-control.md](./08-flow-of-control.md)
- [16-traits.md](./16-traits.md)
