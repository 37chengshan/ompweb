# Other reprs

Alternative `#[repr(...)]` attributes beyond the default `repr(Rust)`. Each trades away layout flexibility for predictability, FFI compatibility, or performance characteristics.

## Signature / Usage

```rust
// repr(C): C-compatible layout for FFI
#[repr(C)]
struct Point { x: f64, y: f64 }

// repr(u8): fix enum discriminant to u8
#[repr(u8)]
enum Color { Red = 0, Green = 1, Blue = 2 }

// repr(transparent): identical layout to the single non-ZST field
#[repr(transparent)]
struct Meters(f64);

// repr(packed): remove all padding
#[repr(packed)]
struct PackedHeader { flags: u8, length: u32 }

// repr(align(64)): force cache-line alignment
#[repr(align(64))]
struct CachePadded<T>(T);

// Combining: repr(C, packed) for C structs with no padding
#[repr(C, packed)]
struct WireFormat { tag: u8, value: u32 }
```

## Options / Props

| Repr | Applies to | Key behavior |
|------|-----------|--------------|
| `repr(C)` | struct, enum, union | Field order matches C; no reordering. Struct size = C struct size. |
| `repr(u*)` / `repr(i*)` | enum | Discriminant type is the specified integer. Enum layout matches C enum of same type. Suppresses null-pointer optimization. |
| `repr(transparent)` | struct or single-variant enum | Identical layout and ABI to the one non-ZST field. Enables safe transmutation between wrapper and inner type. |
| `repr(packed)` / `repr(packed(n))` | struct | At-most-`n` alignment; all padding stripped. |
| `repr(align(n))` | struct | At-least-`n` alignment. Combinable with `repr(C)` or `repr(Rust)`. Incompatible with `repr(packed)`. |

## Notes

- **`repr(u*)` suppresses niche optimization**: `Option<MyReprOption<&T>>` is larger than `Option<MyOption<&T>>` because the null-pointer optimization no longer applies.
  ```rust
  // 8 bytes (optimized, uses null as None)
  size_of::<MyOption<&u16>>() == 8
  // 16 bytes (not optimized — has explicit discriminant)
  size_of::<MyReprOption<&u16>>() == 16
  ```
- **`repr(transparent)` constraints**: exactly one non-zero-sized field (ZST companions allowed). The layout guarantee is only part of the public ABI if the inner field is `pub`. Used by `UnsafeCell<T>` to guarantee transmutability.
- **`repr(packed)` is dangerous**:
  - Taking a reference (`&`) to a packed field may produce a **misaligned reference — UB** on most architectures.
  - x86 penalizes misaligned loads with performance; ARM may fault on them.
  - Only use when you have strict memory-footprint requirements, and access fields only through raw pointer reads.
- **`repr(C)` for enums**: guarantees the discriminant type follows C rules. ZSTs remain zero-sized (unlike C++).
- **`repr(C)` for FFI**: required for structs and enums passed across `extern "C"` boundaries. Use `rust-bindgen` / `cbindgen` to auto-generate layouts.
- **`repr(align(n))`** use cases: padding array elements to cache-line boundaries to prevent false sharing in concurrent code; meeting hardware alignment requirements.

## Related

- [data-layout.md](./data-layout.md)
- [ffi.md](./ffi.md)
- [conversions.md](./conversions.md)
