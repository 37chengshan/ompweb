# no_std Environment

`#![no_std]` is a crate-level attribute that links against `core` instead of `std`. It is essential for bare-metal embedded systems where no OS is present.

## Two Classes of Embedded Programming

| Class | Description | Example |
|-------|-------------|---------|
| Hosted | OS present; POSIX-like syscalls available | Raspberry Pi with Linux |
| Bare Metal | No OS; only the hardware itself | 8-bit MCU with KB-level RAM |

Bare-metal targets always require `#![no_std]`.

## libcore vs libstd

| Feature | libcore | libstd |
|---------|---------|--------|
| Platform-agnostic | Yes | No |
| No OS dependency | Yes | No |
| Language primitives (floats, slices, iterators) | Yes | Yes |
| Processor features (atomics, SIMD) | Yes | Yes |
| Heap / dynamic memory | No* | Yes |
| Collections (Vec, HashMap) | No** | Yes |
| Stack overflow protection | No | Yes |
| Init code before `main()` | No | Yes |

\* Available via `alloc` crate + custom allocator (e.g., `alloc-cortex-m`)  
\*\* Available via `alloc` crate collections; `HashMap`/`HashSet` unavailable (require secure RNG)

## Signature / Usage

```rust
#![no_std]
#![no_main]

use core::panic::PanicInfo;

// Required: define panic handler
#[panic_handler]
fn panic(_info: &PanicInfo) -> ! {
    loop {}
}
```

## Use Cases for no_std

- Bootloaders
- Firmware for microcontrollers
- OS kernels and stage-0 bootstrap code
- Safety-critical resource-constrained systems

## Notes

- `core` provides iterators, Option, Result, formatting traits, and numeric types
- The `alloc` crate (heap collections) requires implementing `GlobalAlloc`
- `libstd`'s runtime (stack-overflow guard, CLI argument handling, main-thread spawn) is not available
- Linker scripts must be provided explicitly (e.g., via `cortex-m-rt` crate's `link.x`)

## Related

- [collections.md](./collections.md)
- [installation.md](./installation.md)
