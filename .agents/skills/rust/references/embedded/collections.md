# Collections

In `no_std` embedded environments, the standard collections (`Vec`, `HashMap`, etc.) from `std` are unavailable. Two alternatives exist: the `alloc` crate (dynamic heap) and the `heapless` crate (fixed-capacity, stack-allocated).

## Option 1: `alloc` Crate (Heap-Allocated)

Provides familiar `Vec`, `String`, `BTreeMap`, etc., but requires a custom global allocator.

### Setup

```rust
#![no_std]
#![no_main]
extern crate alloc;
use alloc::vec::Vec;
```

### Implement GlobalAlloc

```rust
use core::alloc::{GlobalAlloc, Layout};
use core::cell::UnsafeCell;
use core::ptr;
use cortex_m::interrupt;

struct BumpPointerAlloc {
    head: UnsafeCell<usize>,
    end: usize,
}

unsafe impl Sync for BumpPointerAlloc {}

unsafe impl GlobalAlloc for BumpPointerAlloc {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        interrupt::free(|_| {
            let head = self.head.get();
            let align_mask = !(layout.align() - 1);
            let start = (*head + layout.align() - 1) & align_mask;
            if start + layout.size() > self.end {
                ptr::null_mut()
            } else {
                *head = start + layout.size();
                start as *mut u8
            }
        })
    }
    unsafe fn dealloc(&self, _: *mut u8, _: Layout) {}  // bump allocator never frees
}

#[global_allocator]
static HEAP: BumpPointerAlloc = BumpPointerAlloc {
    head: UnsafeCell::new(0x2000_0100),
    end: 0x2000_0200,
};
```

### OOM Handler

```rust
#[alloc_error_handler]
fn on_oom(_layout: Layout) -> ! {
    cortex_m::asm::bkpt();
    loop {}
}
```

## Option 2: `heapless` Crate (Fixed-Capacity)

No allocator needed. Capacity is encoded in the type.

```rust
use heapless::Vec;

let mut xs: Vec<u32, 8> = Vec::new();  // capacity = 8 elements

xs.push(42).unwrap();         // returns Result — capacity could be full
assert_eq!(xs.pop(), Some(42));
```

`heapless` also provides: `String`, `LinearMap`, `BinaryHeap`, `spsc::Queue` (lock-free SPSC queue), etc.

## Trade-offs

| Concern | `alloc` | `heapless` |
|---------|---------|------------|
| API familiarity | High (same as std) | Moderate (capacity in type) |
| Allocator setup | Required | None |
| OOM behavior | Unpredictable location | Explicit `Result` at each push |
| Memory fragmentation | Possible | None |
| Worst-case execution time | Unpredictable (realloc) | Constant-time |
| Real-time safety | No | Yes |
| Total memory verifiable at link time | No | Yes |
| `HashMap` / `HashSet` | No (no RNG in `core`) | `LinearMap` (linear-search) available |

## Notes

- `HashMap` and `HashSet` from `std` require a secure RNG for hash randomization and are not available in `no_std`
- For real-time or safety-critical systems, prefer `heapless` to guarantee deterministic behavior
- The `alloc` crate is stabilized but requires `#![feature(alloc_error_handler)]` for the OOM handler in some Rust versions
- `heapless::spsc::Queue` provides a lock-free single-producer single-consumer queue, useful for ISR-to-main communication

## Related

- [no-std.md](./no-std.md)
- [concurrency.md](./concurrency.md)
