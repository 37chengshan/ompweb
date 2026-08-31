# Ownership Based Resource Management (OBRM / RAII)

OBRM (also called RAII — Resource Acquisition Is Initialization) is the Rust pattern where acquiring a resource means creating an owning object, and releasing the resource happens automatically when that object is dropped. It applies to memory, file handles, threads, sockets, and any other system resource.

## Signature / Usage

```rust
// Drop trait: called automatically when the value goes out of scope
struct FileGuard(std::fs::File);

impl Drop for FileGuard {
    fn drop(&mut self) {
        // cleanup runs here, even on panic
        println!("file closed");
    }
}

// Drop order: fields drop in declaration order; struct drops after fields
struct Outer { first: Inner, second: Inner }
// On drop: Outer::drop → first.drop → second.drop

// Leaking: mem::forget skips the destructor
use std::mem;
let guard = SomeGuard::new();
mem::forget(guard);  // destructor never runs — resource is leaked

// ManuallyDrop: wraps a value without running its destructor
use std::mem::ManuallyDrop;
let val = ManuallyDrop::new(String::from("hello"));
// must call ManuallyDrop::drop or take the inner value manually
```

## Notes

### Destructors

- `Drop::drop` is called automatically; Rust then recursively drops all fields.
- There is **no stable way to suppress recursive field dropping**. If a custom drop needs to deallocate a field's backing memory manually, wrap that field in `Option<T>` and `.take()` it before deallocation, then call `mem::forget` on the taken value to prevent double-free.
- You **cannot move out of `self`** in `Drop::drop` (only `&mut self` is available).

### Leaking

- `mem::forget` is **safe** — leaking a value is not memory-unsafe (the leaked memory simply isn't reclaimed until process exit).
- Unsafe code **must never rely on destructors being run**. Proxy types (iterators, guards) that temporarily leave data in an inconsistent state must handle the `mem::forget` case explicitly (e.g., by truncating `Vec::len` to 0 at the start of `drain` so a forgotten `Drain` leaves the `Vec` empty but valid — "leak amplification").
- `thread::scoped` was removed from std because its safety relied on the `JoinGuard` destructor running, which `mem::forget` could bypass.
- `Rc` aborts on reference-count overflow (caused by forgetting clones) rather than silently producing use-after-free.

### Constructors

- Rust has no special constructor syntax; use inherent `new()` methods by convention.
- **Partial construction is dangerous** if a panic occurs mid-way: any fields already initialized will not be dropped unless the struct itself implements `Drop` carefully.

## Related

- [uninitialized.md](./uninitialized.md)
- [unwinding.md](./unwinding.md)
- [implementing-vec.md](./implementing-vec.md)
