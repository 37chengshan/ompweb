# Atomics

Rust's atomic types (`AtomicUsize`, `AtomicBool`, etc.) provide lock-free, thread-safe operations. The memory model is inherited from C++20 and bridges compiler optimizations, hardware reordering, and cross-thread visibility guarantees through *happens-before* relationships.

## Signature / Usage

```rust
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering, fence};
use std::sync::Arc;

// Simple counter (no cross-thread ordering needed)
let counter = Arc::new(AtomicUsize::new(0));
counter.fetch_add(1, Ordering::Relaxed);

// Spinlock with Acquire/Release
let lock = Arc::new(AtomicBool::new(false)); // false = unlocked
// Acquire the lock
while lock.compare_exchange(false, true, Ordering::Acquire, Ordering::Relaxed).is_err() {}
// ... critical section ...
// Release the lock
lock.store(false, Ordering::Release);

// Explicit fence
fence(Ordering::Acquire); // synchronize with a Release elsewhere
```

## Memory Orderings

| Ordering | Strength | Description |
|----------|---------|-------------|
| `Relaxed` | Weakest | Atomic operation only; no happens-before with other memory. Safe for counters that don't synchronize data. |
| `Acquire` | Moderate | All reads/writes after this point stay after it. Pairs with `Release` on another thread to establish happens-before. |
| `Release` | Moderate | All reads/writes before this point stay before it. Use on stores/RMW operations that "publish" data. |
| `AcqRel` | Moderate | Both Acquire and Release semantics on a single read-modify-write operation. |
| `SeqCst` | Strongest | Total sequential consistency across all threads for all `SeqCst` operations. Use as default when unsure. |

C++20's `consume` ordering is intentionally **not exposed** in Rust due to compiler support difficulties.

## Happens-Before

- Without synchronization, reordering by compiler and hardware makes multi-threaded code correct only by accident.
- `Acquire`/`Release` pairs establish causality: if Thread A `Release`-stores to atomic `X` and Thread B `Acquire`-loads from `X` and sees A's value, then all of A's writes before the store are visible to B after the load.
- `SeqCst` additionally creates a single global order of all `SeqCst` operations visible to all threads.

## Notes

- **It is impossible to write correct synchronized code using only non-atomic data accesses.** Compilers and CPUs may reorder plain loads/stores arbitrarily.
- **Default to `SeqCst`** for correctness; downgrade to weaker orderings only after reasoning carefully about causality.
- **`Relaxed` is for atomicity, not synchronization**: use it for counters/flags that don't need to protect other data.
- **Platform differences**: x86/x64 is strongly ordered — weaker orderings are often free and incorrect code may pass tests. ARM and RISC-V are weakly ordered — bugs will surface. Test on weakly-ordered hardware.
- **`AcqRel` for RMW**: on a `compare_exchange` or `fetch_add` that acts as both a load and a store, `AcqRel` provides both semantics in one operation.
- Standalone `fence(Acquire)` pairs with `fence(Release)` or a `Release` store; it is more coarse-grained than per-operation ordering but sometimes clearer (e.g., in `Arc::drop`).

## Related

- [concurrency.md](./concurrency.md)
- [implementing-arc-and-mutex.md](./implementing-arc-and-mutex.md)
