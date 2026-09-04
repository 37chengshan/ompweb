# Types

Rust supports explicit casting with `as`, type inference from context, and type aliases with `type`. There is no implicit conversion between primitive types.

## Casting with `as`

```rust
fn main() {
    let decimal = 65.4321_f32;

    // Explicit cast — no implicit conversion in Rust
    let integer = decimal as u8;   // 65
    let character = integer as char; // 'A'

    // Overflow wraps for integer targets (modular arithmetic)
    println!("{}", 1000u32 as u8); // 232  (1000 % 256)

    // Float-to-int saturates since Rust 1.45
    println!("{}", 300.0_f32 as u8); // 255
    println!("{}", -1.0_f32 as u8);  // 0
}
```

## Type Inference

```rust
fn main() {
    // Compiler infers Vec<i64> from later push
    let mut vec = Vec::new();
    vec.push(4i64);
}
```

## Type Aliasing with `type`

```rust
type NanoSecond = u64;
type Inch = u64;

fn main() {
    let ns: NanoSecond = 5;
    let inch: Inch = 2;
    // Aliases are the same underlying type, so addition compiles:
    println!("{}", ns + inch);
}
```

## Notes

- Type aliases do not create new types — they are alternative names and provide no extra type safety.
- Alias names should be `UpperCamelCase` (primitives like `usize` are excepted).
- The primary use of aliases is to reduce boilerplate (e.g., `io::Result<T>` = `Result<T, io::Error>`).
- Literals can specify their type via suffix: `42u8`, `3.14f32`.

## Related

- [06-conversion.md](./06-conversion.md)
- [02-primitives.md](./02-primitives.md)
