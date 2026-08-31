# Meet Safe and Unsafe

Rust contains two programming languages: Safe Rust and Unsafe Rust. Safe Rust guarantees type-safety and memory-safety; Unsafe Rust permits additional operations that the compiler cannot verify, shifting correctness responsibility to the programmer.

## Signature / Usage

```rust
// Unsafe block: programmer asserts safety contracts are upheld
unsafe {
    some_unsafe_operation();
}

// Unsafe function: callers must uphold contracts documented in the signature
unsafe fn dangerous() { /* ... */ }

// Unsafe trait: implementors must maintain the safety invariant
unsafe trait Trustworthy { }
unsafe impl Trustworthy for MyType { }
```

## The Five Unsafe Superpowers

Inside an `unsafe` block or `unsafe fn`, you may:

1. Dereference raw pointers (`*const T`, `*mut T`)
2. Call `unsafe` functions (including FFI functions)
3. Access or modify mutable static variables
4. Implement `unsafe` traits
5. Access fields of `union`s

All other Rust rules (borrow checker, type system) still apply inside `unsafe`.

## Notes

- Safe Rust has a soundness property: it can **never** cause Undefined Behavior (UB). Unsafe Rust breaks this guarantee locally.
- The `unsafe` keyword on a function is a contract: callers must satisfy preconditions the compiler cannot check.
- The `unsafe` keyword on a block is a verification: the programmer asserts the block upholds all required contracts.
- Unsafe code must be audited to ensure it respects type-system assumptions. If it does not, the whole program is unsound.
- Whether a trait should be `unsafe` depends on whether unsafe code can reasonably defend against broken implementations. `Ord` is safe (BTreeMap can tolerate buggy implementations); `Send`/`Sync`/`GlobalAlloc` are `unsafe` (broken impls would corrupt memory).
- `Send` and `Sync` are automatically derived for types whose fields also implement them, limiting the spread of `unsafe impl`.

## Related

- [data-layout.md](./data-layout.md)
- [ownership.md](./ownership.md)
- [ffi.md](./ffi.md)
