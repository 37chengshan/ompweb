# Memory Model

Rust's memory model is defined in terms of an abstract machine. Note: **the model is not yet fully formalized** — the reference documents what is decided but acknowledges ongoing work.

## Basic Unit: Bytes

The fundamental unit of memory is a **byte**. Each byte may contain:

1. **An initialized byte** — holds a `u8` value and optional *provenance* (tracking which allocation the byte belongs to).
2. **An uninitialized byte** — reading uninitialized bytes for most types is undefined behavior.

**Provenance** tracks which pointer (and thus which allocation) a byte is associated with. This distinction is absent in hardware but has real consequences for whether a Rust program is well-defined.

## Ownership and Borrowing

Rust's key memory-safety guarantee is enforced statically through the ownership and borrowing system:

- Every value has exactly **one owner**.
- Ownership can be **moved**: the source becomes uninitialized.
- Values can be **borrowed** as shared references (`&T`) or exclusive references (`&mut T`).
- References must not outlive the value they point to (**lifetimes**).

### Borrowing Rules

1. At any time, you may have **either** one `&mut T` **or** any number of `&T` references — never both simultaneously.
2. References must always be **valid** (non-dangling, properly aligned, pointing to initialized memory of the correct type).

## Aliasing

- `&T` — compiler assumes the referenced memory is not mutated (outside `UnsafeCell<T>`).
- `&mut T` — compiler assumes no other reference aliases this memory.
- `Box<T>` — treated similarly to a `&'static mut T` for aliasing purposes.

Violating these assumptions is **undefined behavior**, even inside `unsafe` blocks.

## Memory Allocation and Lifetime

- **Stack allocation**: local variables. Freed automatically when the scope ends (RAII).
- **Heap allocation**: via `Box::new`, `Vec`, `String`, etc. Memory is freed when the owning value drops.
- **Static storage**: `static` items live for the entire program duration.
- **Thread-local storage**: `thread_local!` statics are per-thread.

Destructors (`Drop::drop`) run in reverse order of construction when a value goes out of scope.

## Stack vs Heap

| Aspect | Stack | Heap |
|--------|-------|------|
| Allocation cost | Essentially free | Allocation/deallocation via allocator |
| Size | Must be known at compile time | Can grow dynamically |
| Lifetime | Tied to scope | Tied to owning value |
| Access | Fast (no pointer indirection) | Slower (pointer indirection) |

## Interior Mutability

`UnsafeCell<T>` is the **only** permitted mechanism for mutating data through `&T`. All safe interior mutability types (`Cell<T>`, `RefCell<T>`, `Mutex<T>`, `Atomic*`) are built on top of it.

## Raw Pointers and Provenance

Raw pointers (`*const T`, `*mut T`) are not guaranteed to be valid. Dereferencing them requires `unsafe`. Key provenance rules:

- A raw pointer carries provenance inherited from the original reference/allocation.
- Casting a pointer to `usize` and back may lose provenance (use `ptr::with_exposed_provenance` / `ptr::expose_provenance` for that pattern).
- Pointer arithmetic must stay within the allocation the pointer points to.

## Stacked Borrows (informal model)

An influential informal model (not yet normative) for aliasing:

- Each new borrow creates a "tag" pushed on a conceptual stack.
- Using an older, incompatible tag (e.g., `&mut` while a newer `&mut` to the same location exists) is undefined behavior.
- `UnsafeCell` pops the stack, allowing arbitrary aliasing of the contained value.

## Notes

- The Rust memory model is **not yet fully specified**. What is documented may change.
- For practical guidance on writing correct `unsafe` Rust, see [The Rustonomicon](https://doc.rust-lang.org/nomicon/).
- The `miri` interpreter can detect many memory model violations at runtime.

## Related

- [special-types-and-traits.md](./special-types-and-traits.md)
- [unsafety.md](./unsafety.md)
- [behavior-considered-undefined.md](./behavior-considered-undefined.md)
- [type-system.md](./type-system.md)
