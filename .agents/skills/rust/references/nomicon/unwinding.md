# Unwinding

When Rust code panics, the thread *unwinds*: it walks back through the call stack, running every destructor as if each function had returned normally. This ensures resource cleanup on abnormal termination. Unsafe code must account for panics from safe code.

## Signature / Usage

```rust
// Catching a panic without spawning a thread
use std::panic;

let result = panic::catch_unwind(|| {
    panic!("something went wrong");
});
match result {
    Ok(_) => println!("no panic"),
    Err(_) => println!("caught a panic"),
}

// REQUIRED at FFI boundaries: prevent unwinding into C
extern "C" fn my_callback() {
    let _ = std::panic::catch_unwind(|| {
        rust_code_that_might_panic();
    });
    // handle or ignore; never let panic cross the boundary
}

// "C-unwind" ABI: explicitly allow propagation across FFI
#[unsafe(no_mangle)]
unsafe extern "C-unwind" fn rust_fn() {
    panic!("propagates to C++ as an exception");
}
```

## Rust Error Hierarchy

| Mechanism | Use case |
|-----------|----------|
| `Option<T>` | Value that may reasonably be absent |
| `Result<T, E>` | Fallible operation with recoverable error |
| `panic!` | Programming bug or unrecoverable situation |
| `process::abort()` | Catastrophic failure; no cleanup |

## Exception Safety

Unsafe code that creates a transiently unsound state must ensure panics cannot escape while that state exists:

```rust
// Bad: clone() may panic; len is already advanced
unsafe { self.set_len(self.len() + count); }
for item in iter { self.ptr().add(i).write(item.clone()); }  // PANIC BOMB

// Good: use RAII guards that restore invariants on drop
struct Guard<'a> { vec: &'a mut Vec<u8>, written: usize }
impl Drop for Guard<'_> {
    fn drop(&mut self) { unsafe { self.vec.set_len(self.written); } }
}
```

The RAII guard pattern is the idiomatic solution — it is equivalent to a `finally` block.

## Notes

- **Cost**: Rust's unwinding is optimized for the non-panicking path (zero cost when no panic occurs). Actual unwinding is *more* expensive than in Java or C++ because it is less common.
- **FFI boundary rule**: unwinding across an ABI boundary (into C code) without using the `-unwind` ABI suffix is **Undefined Behavior**. Always use `catch_unwind` at the boundary or use `extern "C-unwind"` if C++ exception interop is needed.
- **`catch_unwind` is not try/catch**: it only catches unwinding panics, not `abort`. Use it sparingly — primarily at FFI boundaries or in thread pools.
- **Poisoning**: `Mutex` marks itself poisoned when a panic occurs inside a locked section. Future `lock()` calls return `Err`. This is a logic-safety mechanism, not memory safety — the data may be in an inconsistent state after the panic.
- Programs compiled with `panic = "abort"` never unwind; `catch_unwind` is a no-op.

## Related

- [ownership-based-resource-management.md](./ownership-based-resource-management.md)
- [concurrency.md](./concurrency.md)
- [ffi.md](./ffi.md)
