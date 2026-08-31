# Concurrency and Races

Rust's ownership system prevents data races at compile time. However, it does not prevent all race conditions — only data races (which are UB). General race conditions are logic errors that Rust allows.

## Signature / Usage

```rust
use std::sync::{Arc, Mutex};
use std::thread;

// Safe shared state: Arc<Mutex<T>>
let data = Arc::new(Mutex::new(vec![1, 2, 3]));
let clone = Arc::clone(&data);

thread::spawn(move || {
    let mut d = clone.lock().unwrap();
    d.push(4);
});

// Safe race condition (logic error, not UB)
use std::sync::atomic::{AtomicUsize, Ordering};
let idx = Arc::new(AtomicUsize::new(0));
// Another thread may increment idx; the bounds check below keeps it memory-safe
println!("{}", data.lock().unwrap()[idx.load(Ordering::SeqCst)]);

// UNSOUND: race condition + unsafe = UB
// if idx < data.len() {
//     unsafe { data.get_unchecked(idx) }  // idx may change between check and use
// }
```

## Send and Sync

| Trait | Meaning |
|-------|---------|
| `Send` | Ownership of `T` can be transferred to another thread |
| `Sync` | `&T` can be shared across threads (`T: Sync` iff `&T: Send`) |

Both are automatically derived for types whose fields also implement them. Override with `unsafe impl` for types that are safe despite compiler's conservative inference (e.g., a raw pointer wrapped in a type with its own synchronization).

Common `!Send` / `!Sync` types: `Rc<T>`, `Cell<T>`, `RefCell<T>`, raw pointers, `UnsafeCell<T>`.

## Data Races vs. Race Conditions

| Concept | Rust prevents? | Effect |
|---------|---------------|--------|
| Data race (concurrent unsynchronized read + write) | Yes (ownership + Send/Sync) | Undefined Behavior |
| Race condition (non-deterministic interleaving) | No | Logic errors; program may panic but no UB in safe code |
| Race condition + unsafe code | No | **Potential UB** |

## Notes

- **Data race definition**: two or more threads access the same memory concurrently; at least one writes; at least one is unsynchronized.
- Safe Rust guarantees absence of data races because aliased mutable references are impossible. Interior mutability types (`Cell`, `RefCell`, `UnsafeCell`) that allow mutation through shared references are `!Sync`.
- **Deadlocks** are not prevented; Rust treats them as logic errors.
- When combining a bounds check with `get_unchecked`, the bounds check and the unsafe access must use the **same** load of the index value. A second atomic load can race with another thread.
- `Mutex` poisoning: if a thread panics while holding a mutex, the mutex is marked poisoned. Subsequent `lock()` returns `Err(PoisonError)`. The data may be logically inconsistent; callers must decide whether to recover or propagate.

## Related

- [atomics.md](./atomics.md)
- [unwinding.md](./unwinding.md)
- [implementing-arc-and-mutex.md](./implementing-arc-and-mutex.md)
