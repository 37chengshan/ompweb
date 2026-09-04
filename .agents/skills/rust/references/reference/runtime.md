# The Rust Runtime

Rust has a minimal runtime. The key runtime-level features are the global allocator, the panic handler, and the program entry point.

## Global Allocator (`#[global_allocator]`)

Selects the memory allocator for the entire program. Applied to a `static` item whose type implements `GlobalAlloc`. Can only be used once in the entire crate graph.

```rust
use core::alloc::{GlobalAlloc, Layout};
use std::alloc::System;

struct MyAllocator;

unsafe impl GlobalAlloc for MyAllocator {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        unsafe { System.alloc(layout) }
    }
    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        unsafe { System.dealloc(ptr, layout) }
    }
}

#[global_allocator]
static GLOBAL: MyAllocator = MyAllocator;
```

The default allocator is the system allocator (`std::alloc::System`). In `#![no_std]` crates you must provide an allocator (or not use heap allocation).

## Panic Handler (`#[panic_handler]`)

Defines what happens on a panic in `#![no_std]` programs. Applied to a function with the signature `fn(&PanicInfo) -> !`:

```rust
#![no_std]

use core::panic::PanicInfo;

#[panic_handler]
fn panic(_info: &PanicInfo) -> ! {
    loop {}
}
```

In programs that link `std`, the panic handler is provided by the standard library and terminates the process (or unwinds the stack, depending on the `panic` setting).

## Entry Point

For a binary crate, the entry point is `main`. For `#![no_std]` embedded programs or custom runtimes, use `#![no_main]` and define your own entry symbol:

```rust
#![no_std]
#![no_main]

#[unsafe(no_mangle)]
pub extern "C" fn _start() -> ! {
    loop {}
}
```

## `Termination` Trait

The return type of `main` must implement `Termination`. The trait determines the process exit code.

Implementations provided by std:
- `()` — exits with code 0
- `!` — never returns
- `Infallible` — never returns
- `ExitCode` — exits with the specified code
- `Result<T: Termination, E: Debug>` — `Ok(t)` delegates to `T`, `Err(e)` prints the error and exits non-zero

```rust
use std::process::ExitCode;

fn main() -> ExitCode {
    if everything_ok() { ExitCode::SUCCESS } else { ExitCode::FAILURE }
}
```

## Windows Subsystem (`#[windows_subsystem]`)

Controls the Windows subsystem when building an executable:

```rust
#![windows_subsystem = "windows"]  // GUI app: no console window
// or
#![windows_subsystem = "console"]  // default: console window
```

Only applies to `bin` crate types on Windows. Ignored on other targets and non-bin crate types.

## `no_std`

`#![no_std]` removes the `std` prelude and replaces it with the `core` prelude. Useful for embedded, operating systems, and other environments without an OS.

Without `std`:
- No heap allocation unless a `#[global_allocator]` and `alloc` crate are used.
- No `std::thread`, `std::fs`, `std::net`, etc.
- `core` and optionally `alloc` are available.
- Must define a `#[panic_handler]`.

## Stack Unwinding vs Abort

Controlled by the `panic` configuration:
- `panic = "unwind"` (default): stack unwinds on panic, running destructors; can be caught with `std::panic::catch_unwind`.
- `panic = "abort"`: process aborts immediately on panic; no destructor calls.

Set in `Cargo.toml`:
```toml
[profile.release]
panic = "abort"
```

## Notes

- The runtime is intentionally minimal; Rust programs can run without an OS.
- `#[global_allocator]` and `#[panic_handler]` may only appear once across the entire dependency graph.

## Related

- [crates-and-source-files.md](./crates-and-source-files.md)
- [linkage.md](./linkage.md)
- [attributes.md](./attributes.md)
- [unsafety.md](./unsafety.md)
