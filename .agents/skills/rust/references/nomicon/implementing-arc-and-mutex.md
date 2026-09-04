# Implementing Arc and Mutex

A guided implementation of `Arc<T>` (atomic reference-counted shared pointer) demonstrating how to combine raw pointers, atomics, `NonNull`, `PhantomData`, and `Send`/`Sync` into a sound thread-safe abstraction. The Mutex section covers `UnsafeCell` for interior mutability.

## Arc Layout

```rust
use std::sync::atomic::AtomicUsize;
use std::ptr::NonNull;
use std::marker::PhantomData;

struct ArcInner<T> {
    rc:   AtomicUsize,  // reference count
    data: T,
}

pub struct Arc<T> {
    ptr:     NonNull<ArcInner<T>>,
    phantom: PhantomData<ArcInner<T>>,  // tells drop-checker Arc owns ArcInner<T>
}

// Safe because mutable access only happens when rc reaches 0 (exclusive ownership)
unsafe impl<T: Sync + Send> Send for Arc<T> {}
unsafe impl<T: Sync + Send> Sync for Arc<T> {}
```

- `NonNull` provides covariance over `T` and the null-pointer niche.
- `PhantomData<ArcInner<T>>` tells the drop-checker that `Arc` notionally owns the inner data, enabling sound `Drop` analysis.

## new / Deref

```rust
impl<T> Arc<T> {
    pub fn new(data: T) -> Arc<T> {
        let boxed = Box::new(ArcInner { rc: AtomicUsize::new(1), data });
        Arc { ptr: NonNull::new(Box::into_raw(boxed)).unwrap(), phantom: PhantomData }
    }
}

impl<T> std::ops::Deref for Arc<T> {
    type Target = T;
    fn deref(&self) -> &T {
        unsafe { &self.ptr.as_ref().data }
    }
}
```

## Clone

```rust
use std::sync::atomic::Ordering;

impl<T> Clone for Arc<T> {
    fn clone(&self) -> Arc<T> {
        let inner = unsafe { self.ptr.as_ref() };
        let old = inner.rc.fetch_add(1, Ordering::Relaxed);
        // Guard against ref-count overflow via mem::forget in adversarial code
        if old >= isize::MAX as usize { std::process::abort(); }
        Arc { ptr: self.ptr, phantom: PhantomData }
    }
}
```

`Relaxed` is sufficient for clone: we are only incrementing a counter; we are not publishing or observing any other data changes at this point.

## Drop

```rust
use std::sync::atomic::{self, Ordering};

impl<T> Drop for Arc<T> {
    fn drop(&mut self) {
        let inner = unsafe { self.ptr.as_ref() };
        // Release: ensures all uses of the data happen-before this decrement
        if inner.rc.fetch_sub(1, Ordering::Release) != 1 { return; }
        // Acquire fence: synchronizes with all Release decrements from other threads
        // Guarantees: data use → decrement → fence → dealloc
        atomic::fence(Ordering::Acquire);
        unsafe { Box::from_raw(self.ptr.as_ptr()); }  // drops ArcInner + data
    }
}
```

**Why Release + Acquire fence rather than `AcqRel` on `fetch_sub`?**
A single `AcqRel` on the last `fetch_sub` would not synchronize with earlier `Release` decrements from other threads. The `Acquire` fence after confirming `rc == 1` ensures all previous thread's `Release` stores are visible before deallocation.

## UnsafeCell and Mutex (overview)

`Mutex<T>` requires interior mutability: shared `&Mutex<T>` references must allow mutation of `T`. `UnsafeCell<T>` is the only legal way to obtain a `*mut T` from a `&T`:

```rust
use std::cell::UnsafeCell;

pub struct Mutex<T> {
    locked: AtomicBool,
    data:   UnsafeCell<T>,
}

impl<T: Send> Mutex<T> {
    pub fn lock(&self) -> MutexGuard<'_, T> {
        while self.locked.compare_exchange(false, true, Ordering::Acquire, Ordering::Relaxed).is_err() {}
        MutexGuard { mutex: self }
    }
}

impl<T> std::ops::Deref for MutexGuard<'_, T> {
    type Target = T;
    fn deref(&self) -> &T {
        unsafe { &*self.mutex.data.get() }
    }
}

impl<T> Drop for MutexGuard<'_, T> {
    fn drop(&mut self) {
        self.mutex.locked.store(false, Ordering::Release);
    }
}
```

## Notes

- **Do not use `*mut T` directly for shared ownership**: it is invariant over `T` and does not carry ownership information for the drop-checker. Use `NonNull<T>` + `PhantomData`.
- **`UnsafeCell` is the only legal interior mutability primitive**: casting `&T` to `*mut T` without `UnsafeCell` is UB because the optimizer assumes `&T` is immutable.
- **`Mutex` is `!Sync` for `T: !Send`**: even though `&Mutex<T>` only exposes `&T` normally, the `DerefMut` through the guard exposes `&mut T` across threads, which requires `T: Send`.
- Memory ordering in `Arc::drop` must use a fence rather than `AcqRel` on `fetch_sub` because `AcqRel` only synchronizes with the immediately preceding `Release` from another thread, not all earlier ones.

## Related

- [atomics.md](./atomics.md)
- [concurrency.md](./concurrency.md)
- [ownership-based-resource-management.md](./ownership-based-resource-management.md)
