# Chapter 3: Common Programming Concepts

Fundamental Rust building blocks: variables, data types, functions, comments, and control flow.

## Variables and Mutability

```rust
let x = 5;          // immutable by default
let mut y = 5;      // mutable
y = 6;              // OK

const MAX: u32 = 100_000;  // constant: always immutable, type required

// Shadowing: re-bind with let (can change type)
let spaces = "   ";
let spaces = spaces.len();  // now usize, not &str
```

- Constants use `ALL_CAPS_SNAKE_CASE`, must be type-annotated, and can be set only to compile-time expressions.
- Shadowing allows type changes; `mut` does not.

## Data Types

### Scalar types

| Type | Examples |
|------|---------|
| Integers | `i8`/`u8` … `i128`/`u128`, `isize`/`usize`; default `i32` |
| Floats | `f32`, `f64`; default `f64` |
| Boolean | `bool`: `true` / `false` |
| Character | `char`: single quotes, 4-byte Unicode scalar |

```rust
let decimal = 98_222;   // underscores for readability
let hex     = 0xff;
let binary  = 0b1111_0000;
let byte    = b'A';     // u8 only
```

### Compound types

```rust
// Tuple (fixed length, mixed types)
let tup: (i32, f64, u8) = (500, 6.4, 1);
let (x, y, z) = tup;   // destructure
let five_hundred = tup.0;

// Array (fixed length, same type)
let a: [i32; 5] = [1, 2, 3, 4, 5];
let zeros = [0; 5];     // [0, 0, 0, 0, 0]
let first = a[0];       // index access; out-of-bounds panics at runtime
```

## Functions

```rust
fn add(x: i32, y: i32) -> i32 {
    x + y   // expression (no semicolon) = return value
}
```

- Parameter types are always required.
- The last expression (without `;`) is the return value.
- Adding `;` turns an expression into a statement that returns `()`.
- Function definition order does not matter.

## Control Flow

```rust
// if as expression
let number = if condition { 5 } else { 6 };  // arms must be same type

// loop with return value
let result = loop {
    counter += 1;
    if counter == 10 { break counter * 2; }
};

// Loop labels for nested loops
'outer: loop {
    loop { break 'outer; }
}

// while
while number != 0 { number -= 1; }

// for over collection or range
for element in array { println!("{element}"); }
for n in (1..4).rev() { println!("{n}"); }
```

## Notes

- Integer overflow: debug builds panic; release builds wrap (two's complement).
- Array out-of-bounds access panics at runtime (memory-safe).
- `if` conditions must be `bool` — Rust does not auto-convert numbers to booleans.
- `for` is preferred over `while` with indices: safer and often faster.

## Related

- [Chapter 2: Programming a Guessing Game](./02-guessing-game.md)
- [Chapter 4: Understanding Ownership](./04-ownership.md)
