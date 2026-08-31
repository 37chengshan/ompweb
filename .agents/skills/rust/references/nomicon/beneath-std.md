# Beneath std

Building Rust programs that do not depend on the standard library (`#![no_std]`). Required for embedded systems, OS kernels, and other bare-metal environments.

## Signature / Usage

```rust
#![feature(lang_items, core_intrinsics, rustc_private)]
#![allow(internal_features)]
#![no_std]
#![no_main]

#![feature(panic_unwind)]
extern crate unwind;

#[cfg(not(windows))]
extern crate libc;

use core::ffi::{c_char, c_int};
use core::panic::PanicInfo;

// Entry point (name depends on target: main, _start, WinMain, …)
#[unsafe(no_mangle)]
extern "C" fn main(_argc: c_int, _argv: *const *const c_char) -> c_int {
    0
}

// Required: lang item for exception handling (non-Windows Unix)
#[lang = "eh_personality"]
fn rust_eh_personality() {}

// Required: panic handler
#[panic_handler]
fn panic_handler(_info: &PanicInfo) -> ! {
    core::intrinsics::abort()
}
```

## Cargo.toml dependencies

```toml
[dependencies]
libc = { version = "0.2", default-features = false }
# default-features = false is critical: libc's defaults pull in std
```

## What `std` provides that must be replaced

| Feature | Replacement / approach |
|---------|----------------------|
| Panic handler | `#[panic_handler]` fn |
| `eh_personality` (unwinding) | `#[lang = "eh_personality"]` (nightly) or `panic = "abort"` |
| Heap allocation | Custom `GlobalAlloc` impl + `#[global_allocator]` |
| Entry point (`fn main`) | `#![no_main]` + manual `_start` / `main` symbol |
| `core` types | Available without std (`#[no_std]` implies `extern crate core`) |
| `alloc` types | Available with `extern crate alloc` + a global allocator |

## Notes

- **Nightly required** for many bare-metal targets: the `eh_personality` lang item is unstable. The workaround is to compile with `panic = "abort"` in `Cargo.toml`, which eliminates the need for `eh_personality` entirely.
- **Compiler intrinsics**: targets without pre-built `std` binaries may produce linker errors for symbols like `__aeabi_memcpy`. Link `compiler_builtins` explicitly, or cross-compile `std` with `cargo build -Z build-std`.
- **Windows-MSVC**: does not require `libc`; including it causes compile errors. Use `#[cfg(not(windows))]`.
- **`core` vs `std`**: `core` is a strict subset of `std` with no OS or heap dependencies. All `std` types that don't need a heap or OS are available in `core`.
- **`alloc` crate**: provides `Box`, `Vec`, `String`, `Arc`, etc. without the rest of `std`. Requires a `#[global_allocator]`.
- **Custom global allocator**:
  ```rust
  use std::alloc::{GlobalAlloc, Layout};
  struct MyAllocator;
  unsafe impl GlobalAlloc for MyAllocator {
      unsafe fn alloc(&self, layout: Layout) -> *mut u8 { /* ... */ }
      unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) { /* ... */ }
  }
  #[global_allocator]
  static A: MyAllocator = MyAllocator;
  ```

## Related

- [ffi.md](./ffi.md)
- [meet-safe-and-unsafe.md](./meet-safe-and-unsafe.md)
