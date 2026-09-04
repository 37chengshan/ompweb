# Data Layout

Covers how Rust represents types in memory: alignment, padding, struct/enum layout, `repr` attributes, and niche optimization. Understanding layout is essential for FFI and unsafe pointer manipulation.

## Signature / Usage

```rust
// Default repr: Rust may reorder fields for efficiency
struct A { a: u8, b: u32, c: u16 }
// Actual layout may be: b (u32), c (u16), a (u8), _pad (u8)

// repr(C): guaranteed C-compatible field order
#[repr(C)]
struct B { a: u8, b: u32, c: u16 }

// repr(transparent): identical layout to the single non-ZST field
#[repr(transparent)]
struct Wrapper(f32);

// repr(packed): strip all padding (use with care — UB risk)
#[repr(packed)]
struct Packed { a: u8, b: u32 }

// repr(align(N)): force at-least-N alignment
#[repr(align(64))]
struct CacheLine([u8; 64]);

// repr(u8/i32/…): fix discriminant type for enums
#[repr(u8)]
enum Tag { A, B, C }
```

## Options / Props

| Repr | Applies to | Effect |
|------|-----------|--------|
| `repr(Rust)` (default) | structs, enums | Fields may be reordered; layout is unspecified and unstable |
| `repr(C)` | structs, enums, unions | C-compatible field order; no reordering |
| `repr(transparent)` | single-field structs / single-variant enums | Identical layout and ABI to the inner field |
| `repr(packed)` / `repr(packed(n))` | structs | At-most-`n` alignment; removes padding |
| `repr(align(n))` | structs | At-least-`n` alignment; can combine with `repr(C)` |
| `repr(u*)` / `repr(i*)` | enums | Fixes discriminant integer type |

## Notes

- **Alignment**: every type has an alignment ≥ 1 that is a power of 2. A type's size is always a multiple of its alignment.
- **No layout stability across compilations**: `repr(Rust)` layout is not guaranteed to be the same between compiler versions or even between different monomorphizations of the same generic type.
- **Null pointer optimization (niche optimization)**: `Option<&T>`, `Option<Box<T>>`, etc. are the same size as the pointer because the `None` variant is encoded as a null pointer. Using `repr(u*)` on an enum suppresses this optimization.
- **`repr(packed)` risks**: taking a reference to a packed field can cause a misaligned reference — **Undefined Behavior**. Accessing packed fields through raw pointers is safer.
- **`repr(transparent)` constraint**: exactly one non-zero-sized field; zero-sized fields are allowed alongside it.
- For FFI, prefer `repr(C)` and use tools like `rust-bindgen` / `cbindgen` to generate bindings automatically.

## Related

- [meet-safe-and-unsafe.md](./meet-safe-and-unsafe.md)
- [other-reprs.md](./other-reprs.md)
- [ffi.md](./ffi.md)
