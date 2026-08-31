# Primitives

Rust's primitive types include scalar types (integers, floats, bool, char) and compound types (arrays, tuples). The compiler infers types from context; integers default to `i32`, floats to `f64`.

## Scalar Types

| Category | Types |
|----------|-------|
| Signed integers | `i8`, `i16`, `i32`, `i64`, `i128`, `isize` |
| Unsigned integers | `u8`, `u16`, `u32`, `u64`, `u128`, `usize` |
| Floating point | `f32`, `f64` |
| Character | `char` (Unicode scalar value, 4 bytes) |
| Boolean | `bool` (`true` / `false`) |
| Unit | `()` |

## Compound Types

| Type | Example | Description |
|------|---------|-------------|
| Array | `[1, 2, 3]` | Fixed-size, same type |
| Tuple | `(1, true, 3.0)` | Fixed-size, mixed types |

## Signature / Usage

```rust
fn main() {
    // Explicit type annotation
    let logical: bool = true;
    let an_integer = 5i32;     // suffix annotation

    // Default types
    let default_float = 3.0;   // f64
    let default_integer = 7;   // i32

    // Type inferred from later use
    let mut inferred_type = 12;
    inferred_type = 4294967296i64;

    // Mutable variable
    let mut mutable = 12;
    mutable = 21;

    // Shadowing (rebind with new let)
    let mutable = true;

    // Array: [Type; length]
    let my_array: [i32; 5] = [1, 2, 3, 4, 5];

    // Tuple
    let my_tuple = (5u32, 1u8, true, -5.04f32);
}
```

## Notes

- Integer overflow panics in debug mode; wraps in release mode.
- `usize` / `isize` size matches the pointer width of the platform (32 or 64 bit).
- Subsections: Literals and operators, Tuples, Arrays and slices.

## Related

- [05-types.md](./05-types.md)
- [06-conversion.md](./06-conversion.md)
