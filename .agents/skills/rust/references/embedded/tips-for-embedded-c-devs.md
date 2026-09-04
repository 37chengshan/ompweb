# Tips for Embedded C Developers

Key Rust idioms and their C equivalents for developers migrating from C-based embedded development.

## Preprocessor → Cargo Features + cfg

```toml
# Cargo.toml
[features]
FIR = []
IIR = []
```

```rust
// Instead of #ifdef FIR
#[cfg(feature = "FIR")]
pub mod fir;

#[cfg(feature = "IIR")]
pub mod iir;
```

Compile-time constants via `const fn` (replaces `#define`):

```rust
const fn buffer_size() -> usize {
    #[cfg(feature = "use_more_ram")] { 1024 }
    #[cfg(not(feature = "use_more_ram"))] { 128 }
}
static BUF: [u32; buffer_size()] = [0u32; buffer_size()];
```

## Build System: Cargo replaces Make/CMake

Cross-compilation:
```bash
cargo build --target thumbv7em-none-eabihf
```

`build.rs` for C library linking, generated code, or linker script embedding.

## Iterators vs Index Loops

```rust
let arr = [0u16; 16];

// Prefer iterators — enables bounds-check elimination and SIMD
for element in arr.iter() {
    process(*element);
}

// Avoid — bounds check on every access, blocks optimizations
for i in 0..arr.len() {
    process(arr[i]);
}
```

## Raw Pointers vs References

- `*const T` / `*mut T` (raw pointers): require `unsafe`, only for hardware access or FFI
- `&T` / `&mut T` (references): memory-safe, preferred everywhere else
- References are immutable by default; `&mut` must be requested explicitly (unlike C where everything is mutable)

## Volatile Access (replaces `volatile` keyword)

```c
/* C */
volatile bool signalled = false;
void ISR()    { signalled = true; }
void driver() { while (!signalled) {} signalled = false; }
```

```rust
// Rust
static mut SIGNALLED: bool = false;

#[interrupt]
fn ISR() { unsafe { core::ptr::write_volatile(&mut SIGNALLED, true) }; }

fn driver() {
    loop {
        while unsafe { !core::ptr::read_volatile(&SIGNALLED) } {}
        unsafe { core::ptr::write_volatile(&mut SIGNALLED, false) };
        run_task();
    }
}
```

Higher-level alternatives: `volatile_register` crate, `core::sync::atomic` types.

## Memory Layout (replaces `__attribute__((packed))`)

```rust
// Default layout — unpredictable, do NOT use for hardware registers
struct Foo { x: u16, y: u8, z: u16 }

// C-compatible with padding
#[repr(C)]
struct Foo { x: u16, y: u8, z: u16 }

// No padding (like __attribute__((packed)))
#[repr(packed)]
struct Foo { x: u16, y: u8, z: u16 }

// C-compatible AND custom alignment (like __attribute__((aligned(4096))))
#[repr(C, align(4096))]
struct PageAligned { x: u16 }
```

Note: Cannot combine `repr(align(n))` with `repr(packed)`.

## Macros → Functions with Inline

Rust macros are powerful but prefer `#[inline]` / `#[inline(always)]` functions first — they're type-safe and show up in rustdoc:

```rust
#[inline(always)]
fn set_bit(reg: &mut u32, bit: u32) {
    *reg |= 1 << bit;
}
```

## Notes

- `cfg` attributes are checked at compile time, not preprocessed textually — no token-paste tricks needed
- `build.rs` runs on the host machine so it can use any host Rust crate
- `repr(packed)` fields may be unaligned; reading them requires `core::ptr::read_unaligned` in some cases
- Rust's borrow checker eliminates the category of bugs caused by pointer aliasing in C

## Related

- [no-std.md](./no-std.md)
- [interoperability.md](./interoperability.md)
- [concurrency.md](./concurrency.md)
