# Working with Uninitialized Memory

All runtime-allocated memory begins life as uninitialized. Reading from uninitialized memory—regardless of what type the bits are interpreted as—is **Undefined Behavior**. Rust provides both checked (compile-time tracked) and unchecked (`MaybeUninit`) mechanisms for handling this safely.

## Signature / Usage

```rust
use std::mem::{self, MaybeUninit};

// Compile-time checking: Rust tracks initialization through branches
let x: i32;
if condition { x = 1; } else { x = 2; }
println!("{x}"); // OK: both branches initialize x

// MaybeUninit: defer initialization safely
let mut uninit: MaybeUninit<u32> = MaybeUninit::uninit();
uninit.write(42);
let value: u32 = unsafe { uninit.assume_init() };

// Initializing an array element-by-element
const N: usize = 10;
let arr: [Box<u32>; N] = {
    let mut tmp = [const { MaybeUninit::uninit() }; N];
    for (i, slot) in tmp.iter_mut().enumerate() {
        slot.write(Box::new(i as u32));
    }
    unsafe { mem::transmute::<_, [Box<u32>; N]>(tmp) }
};
```

## Key APIs

| API | Description |
|-----|-------------|
| `MaybeUninit::uninit()` | Creates uninitialized storage |
| `MaybeUninit::new(val)` | Creates initialized storage |
| `MaybeUninit::write(val)` | Writes value without dropping old content |
| `MaybeUninit::assume_init()` | Unsafely treats storage as initialized |
| `ptr::write(ptr, val)` | Moves `val` to `*ptr` without dropping old data |
| `ptr::read(ptr)` | Copies bits from `*ptr`, leaving source logically uninit |
| `ptr::copy(src, dst, count)` | Like C `memmove` |
| `ptr::copy_nonoverlapping(src, dst, count)` | Like C `memcpy` |

## Notes

- **Never use `mem::uninitialized()`** — it is deprecated and causes immediate UB for most types. Use `MaybeUninit` instead.
- **Direct assignment is wrong for uninitialized memory**: `*slot = Box::new(x)` attempts to drop the old (uninitialized) value, which is UB. Use `ptr::write` or `MaybeUninit::write`.
- **References to uninitialized memory are always UB**: even creating a `&T` pointing to uninitialized bytes is UB. Use raw pointer syntax (`&raw mut (*ptr).field`) to take the address of a field before initializing it.
- **Drop on uninitialized data is UB**: every control path (including panics) through a variable with a destructor must initialize it before going out of scope. `MaybeUninit` itself has no drop glue, so partial initialization during loops is safe if the initialized portion is tracked manually.
- **Transmute constraint**: `[MaybeUninit<T>; N]` has the same layout as `[T; N]`, making transmutation safe for arrays. `Option<MaybeUninit<T>>` does **not** have the same layout as `Option<T>`.
- Safe Rust prevents reading uninitialized stack variables at compile time via branch analysis. The borrow checker does not evaluate actual values, only control flow.

## Related

- [conversions.md](./conversions.md)
- [ownership-based-resource-management.md](./ownership-based-resource-management.md)
- [implementing-vec.md](./implementing-vec.md)
