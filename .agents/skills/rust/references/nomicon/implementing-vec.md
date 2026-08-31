# Implementing Vec

A guided walk-through of building `Vec<T>` from scratch using stable Rust. This chapter demonstrates how to apply unsafe primitives — raw allocator APIs, raw pointers, `ptr::write`/`ptr::read`, variance, `PhantomData`, and `Drop` — in a coherent safe abstraction.

## Layout

```rust
use std::ptr::NonNull;
use std::marker::PhantomData;

pub struct Vec<T> {
    ptr: NonNull<T>,  // NonNull: covariant over T, never null
    cap: usize,
    len: usize,
}

// Must be declared manually because NonNull<T> is covariant (not Send/Sync by itself)
unsafe impl<T: Send> Send for Vec<T> {}
unsafe impl<T: Sync> Sync for Vec<T> {}
```

`NonNull<T>` is preferred over `*mut T` because it is **covariant** over `T` (allowing `Vec<&'static str>` where `Vec<&'a str>` is expected) and carries a null-pointer guarantee enabling `Option<Vec<T>>` size optimization.

## Allocation

```rust
use std::alloc::{self, Layout};

impl<T> Vec<T> {
    pub fn new() -> Self {
        assert!(std::mem::size_of::<T>() != 0, "ZSTs require special handling");
        Vec { ptr: NonNull::dangling(), cap: 0, len: 0 }
    }

    fn grow(&mut self) {
        let new_cap = if self.cap == 0 { 1 } else { 2 * self.cap };
        let layout = Layout::array::<T>(new_cap).unwrap();
        // isize::MAX limit: ptr::offset takes isize; exceeding it is UB
        assert!(layout.size() <= isize::MAX as usize, "allocation too large");

        let ptr = if self.cap == 0 {
            unsafe { alloc::alloc(layout) }
        } else {
            let old_layout = Layout::array::<T>(self.cap).unwrap();
            unsafe { alloc::realloc(self.ptr.as_ptr() as *mut u8, old_layout, layout.size()) }
        };

        self.ptr = NonNull::new(ptr as *mut T)
            .unwrap_or_else(|| alloc::handle_alloc_error(layout));
        self.cap = new_cap;
    }
}
```

## Push / Pop

```rust
use std::ptr;

impl<T> Vec<T> {
    pub fn push(&mut self, elem: T) {
        if self.len == self.cap { self.grow(); }
        unsafe { ptr::write(self.ptr.as_ptr().add(self.len), elem); }
        self.len += 1;  // increment AFTER write (panic-safe ordering)
    }

    pub fn pop(&mut self) -> Option<T> {
        if self.len == 0 { return None; }
        self.len -= 1;
        unsafe { Some(ptr::read(self.ptr.as_ptr().add(self.len))) }
    }
}
```

- `ptr::write` overwrites memory **without** dropping the old value and **without** assuming the slot is initialized.
- `ptr::read` copies bits out and leaves the source logically uninitialized.
- Direct assignment (`*slot = elem`) is wrong on uninitialized memory — it attempts to drop the old (garbage) value.

## Drop

```rust
impl<T> Drop for Vec<T> {
    fn drop(&mut self) {
        if self.cap != 0 {
            // Drop all initialized elements
            while let Some(_) = self.pop() {}
            let layout = Layout::array::<T>(self.cap).unwrap();
            unsafe { alloc::dealloc(self.ptr.as_ptr() as *mut u8, layout); }
        }
    }
}
```

## Deref / DerefMut

```rust
use std::ops::{Deref, DerefMut};

impl<T> Deref for Vec<T> {
    type Target = [T];
    fn deref(&self) -> &[T] {
        unsafe { std::slice::from_raw_parts(self.ptr.as_ptr(), self.len) }
    }
}

impl<T> DerefMut for Vec<T> {
    fn deref_mut(&mut self) -> &mut [T] {
        unsafe { std::slice::from_raw_parts_mut(self.ptr.as_ptr(), self.len) }
    }
}
```

## Notes

- **Zero-sized types (ZSTs)**: `Layout::array::<T>(n)` returns size 0 for ZSTs; `alloc` with a zero-size layout is UB. A real Vec implementation must handle ZSTs specially (use `NonNull::dangling()` permanently, only advance `len`).
- **isize::MAX cap limit**: `ptr::offset` takes `isize`; allocating more than `isize::MAX` bytes and offsetting into the region is UB even on 64-bit systems.
- **Exception safety for `insert`/`remove`**: shifts using `ptr::copy` must update length only after the copy succeeds so that a panic in a `Clone` impl doesn't expose uninitialized slots.
- **IntoIter** stores both a `start` pointer and an `end` pointer (or count) and must implement `Drop` to free the remaining unread elements plus the buffer.
- **Drain** sets `Vec::len` to 0 immediately so that `mem::forget` on the `Drain` guard leaks elements but leaves the `Vec` in a valid (empty) state — the "leak amplification" pattern.

## Related

- [uninitialized.md](./uninitialized.md)
- [ownership-based-resource-management.md](./ownership-based-resource-management.md)
- [data-layout.md](./data-layout.md)
- [implementing-arc-and-mutex.md](./implementing-arc-and-mutex.md)
