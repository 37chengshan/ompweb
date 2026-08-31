# Type Conversions

Rust provides multiple mechanisms for converting between types: implicit coercions (automatic weakening), explicit casts (`as`), and `mem::transmute` for bit-level reinterpretation.

## Signature / Usage

```rust
// Coercion: &mut T → &T (implicit, happens at call sites)
let mut x: i32 = 5;
let r: &i32 = &mut x;  // coercion applied automatically

// Cast with `as` (explicit, superset of coercions)
let a: u32 = 300u32;
let b = a as u8;        // truncates to 44; infallible at runtime
let p: *const i32 = &a as *const i32 as *const u32 as *const i32;

// Transmute (bit-level reinterpretation, extremely dangerous)
use std::mem;
let bits: u32 = 0x3F800000;
let f: f32 = unsafe { mem::transmute(bits) };  // 1.0f32

// Safe alternative: from_bits (preferred over transmute for primitives)
let f2 = f32::from_bits(bits);
```

## Coercions

Coercions are implicit type weakenings that occur in specific contexts (function arguments, assignments with a known target type). Common coercions:

| From | To |
|------|----|
| `&mut T` | `&T` |
| `&T` | `*const T` |
| `&mut T` | `*mut T` |
| `T` | `U` when `T: Deref<Target=U>` (Deref coercion) |
| `[T; N]` | `[T]` (slice coercion) |
| lifetime shortening | `&'long T` → `&'short T` |

**Critical limitation**: coercions are **not** applied when matching trait bounds. If `impl Trait for &i32` exists and `&mut i32` coerces to `&i32`, calling `foo::<&mut i32>()` where `foo<X: Trait>` still fails.

## Casts (`as`)

- Superset of coercions; require explicit `as` keyword.
- Focus on numeric primitives and raw pointers.
- **Not transitively safe**: `e as U1 as U2` may be valid where `e as U2` is not.
- **Slice length is not adjusted** when casting `*const [u16]` to `*const [u8]` — the slice will point to the same bytes but its `len` field remains the element count of `u16`, causing the slice to cover only half the memory. Use explicit pointer arithmetic instead.
- Casts are not marked `unsafe` because creating a raw pointer is safe; *using* the pointer is the unsafe part.

## Transmute

`mem::transmute<T, U>` reinterprets `T` bits as `U`. Both types must have the same size (compile-time check).

| Situation | Risk |
|-----------|------|
| Invalid type state (e.g., `3u8` as `bool`) | Immediate UB even if value is never used |
| `&T` to `&mut T` | Always UB; optimizer assumes `&T` is immutable |
| Compound types (`Vec<i32>` ↔ `Vec<u32>`) | Layout is unspecified for `repr(Rust)`; UB |
| `repr(C)` or `repr(transparent)` structs | May be safe if layouts provably match |
| Unbounded lifetimes | UB if the produced reference outlives the data |

`mem::transmute_copy<T, U>` copies `size_of::<U>()` bytes from `&T`; loses even the size check — more dangerous.

## Notes

- Prefer `T::from(x)`, `x.try_into()`, or `From`/`Into` traits for semantic conversions.
- Prefer `f32::from_bits` / `f32::to_bits` over transmute for float↔integer conversions.
- Transmute is "the most horribly unsafe thing you can do in Rust." Find another way first.

## Related

- [data-layout.md](./data-layout.md)
- [uninitialized.md](./uninitialized.md)
- [ffi.md](./ffi.md)
