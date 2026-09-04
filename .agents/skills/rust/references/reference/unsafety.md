# Unsafety

The `unsafe` keyword is a **proof obligation system**: it marks where safety invariants cannot be verified by the compiler and requires the programmer to take responsibility.

## Contexts

| Syntax | Purpose |
|--------|---------|
| `unsafe fn` | Declares that callers must uphold extra conditions |
| `unsafe { }` | Asserts that the programmer has verified safety conditions |
| `unsafe trait` | Declares that implementors must uphold extra conditions |
| `unsafe impl` | Asserts that the trait's safety conditions are satisfied |
| `unsafe extern` | Declares that external function signatures are correct |
| `unsafe static` | Declares that the external static is correctly typed |
| `#[unsafe(attr)]` | Applies an attribute whose safety conditions are programmer-verified |

## Unsafe Functions (`unsafe fn`)

A function with preconditions the compiler cannot verify. Callers must call it from within an `unsafe` block.

```rust
unsafe fn get_unchecked<T>(slice: &[T], index: usize) -> &T {
    // Safety: caller must guarantee index < slice.len()
    &*slice.as_ptr().add(index)
}
```

The function body itself is implicitly an unsafe block — it may perform unsafe operations.

## Unsafe Blocks (`unsafe { }`)

Assert that all proof obligations for operations within the block are satisfied by the programmer.

```rust
let slice = &[1, 2, 3];
let elem = unsafe { get_unchecked(slice, 1) };
```

Used for:
- Calling `unsafe fn`
- Dereferencing raw pointers (`*ptr`)
- Accessing or modifying `static mut` variables
- Implementing `unsafe` traits via `unsafe impl`
- Accessing fields of `union` types

## Unsafe Traits (`unsafe trait`)

A trait whose implementation requires extra invariants the compiler cannot check.

```rust
unsafe trait MyUnsafeTrait {
    // Safety: implementors must guarantee XYZ
}

unsafe impl MyUnsafeTrait for MyType {}
```

Examples from `std`: `Send`, `Sync`.

## Unsafe Extern Blocks

Declarations of external functions/statics with signatures the programmer guarantees are correct:

```rust
unsafe extern "C" {
    fn strlen(s: *const i8) -> usize;
    static errno: i32;
}
```

From the 2024 edition, `extern` blocks must be prefixed with `unsafe`. Individual items may be marked `safe` to indicate they are safe to call despite being in an `unsafe extern` block:

```rust
unsafe extern "C" {
    safe fn abs(x: i32) -> i32;   // can be called without unsafe
    unsafe fn gets(s: *mut i8) -> *mut i8;  // still requires unsafe
}
```

## Unsafe Attributes

Attributes with safety implications are wrapped in `unsafe(...)`:

```rust
#[unsafe(no_mangle)]
pub fn exported_symbol() {}

#[unsafe(export_name = "custom_name")]
pub fn renamed() {}

#[unsafe(link_section = ".data")]
pub static VAR: u32 = 0;
```

## Unsafe Operations

The following operations require an `unsafe` block:

1. **Calling `unsafe fn`**
2. **Dereferencing raw pointers** (`*const T`, `*mut T`)
3. **Accessing/modifying `static mut` items**
4. **Accessing fields of `union` values**
5. **Calling functions via FFI** (in `extern` blocks without `safe`)
6. **Using inline assembly** (`asm!`, `naked_asm!`)
7. **Implementing `unsafe` traits** (requires `unsafe impl`)

## Guidelines

- **Document safety preconditions** on every `unsafe fn` and `unsafe impl`.
- **Minimize unsafe surface area**: wrap `unsafe` in a small, well-documented function with a safe API.
- **Sound unsafe code**: code where safe callers cannot trigger undefined behavior.
- Before writing `unsafe` code, read [The Rustonomicon](https://doc.rust-lang.org/nomicon/).

## Notes

- `unsafe` does not disable the borrow checker or type system; it only enables the additional operations listed above.
- Undefined behavior inside `unsafe` blocks is still undefined behavior — `unsafe` is a declaration of responsibility, not a free pass.

## Related

- [behavior-considered-undefined.md](./behavior-considered-undefined.md)
- [memory-model.md](./memory-model.md)
- [inline-assembly.md](./inline-assembly.md)
- [abi.md](./abi.md)
