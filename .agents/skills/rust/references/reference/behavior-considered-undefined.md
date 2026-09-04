# Behavior Considered Undefined

Rust code is **incorrect** if it exhibits undefined behavior (UB), including code inside `unsafe` blocks. The `unsafe` keyword means the programmer is responsible for preventing UB — it does not excuse its occurrence.

## Complete List of Undefined Behaviors

### 1. Data Races

Concurrent access to shared mutable data without synchronization. Use `Mutex`, `RwLock`, or `Atomic*` types.

### 2. Dangling Pointer Access

Accessing memory through a pointer/reference that does not point to a live allocation. A pointer is "dangling" if any byte it covers is not part of the same live allocation.

**Exception**: Zero-sized pointers/references are never considered dangling (even if null).

### 3. Misaligned Pointer Access

Dereferencing a pointer not properly aligned for its type. Alignment is determined by the **pointer's type**, not the field being accessed:

```rust
let ptr: *const S; // S has alignment 8
(*ptr).f;          // UB if ptr is not 8-byte aligned, even if f is u8
```

Creating raw references (`&raw const`/`&raw mut`) to unaligned addresses is allowed; loading/storing is not.

### 4. Out-of-Bounds Place Projections

Violating pointer arithmetic rules through field access, tuple indexing, or array/slice indexing that extends past the allocation boundary.

### 5. Pointer Aliasing Violations

- `&T` must point to memory that is not mutated (except `UnsafeCell<U>`).
- `&mut T` must point to memory that is not read or written by any other pointer, and it must be the only reference.
- `Box<T>` has aliasing requirements similar to `&'static mut T`.

### 6. Mutating Immutable Bytes

Writing to memory that is considered immutable:
- Memory in const-promoted expressions
- Memory owned by immutable bindings/statics (except `UnsafeCell<U>`)
- Memory pointed to by shared references (except `UnsafeCell<U>`)

Any write of more than 0 bytes overlapping immutable bytes is UB, even if contents don't change.

### 7. Producing Invalid Values

Creating values that violate their type's validity invariant:

| Type | Validity Requirement |
|------|---------------------|
| `bool` | Must be `0x00` (false) or `0x01` (true) |
| Function pointer | Must be non-null and point to a valid function |
| `char` | Not in range `0xD800..=0xDFFF`, must be ≤ `0x10FFFF` |
| `!` | Must never exist as a value |
| `i*`, `u*`, `f*` | Must be initialized (no uninitialized bytes) |
| `str` | Must be initialized, valid UTF-8 |
| `enum` | Discriminant must be valid; fields must be valid for the variant |
| `struct`/`tuple`/`array` | All fields must be valid |
| `&T`, `Box<T>` | Aligned, non-null, non-dangling, points to a valid `T` |
| Wide references/boxes | Correct metadata (vtable for `dyn Trait`; valid `usize` for `[T]`) |
| `NonNull<T>`, `NonZero<T>` | Must be non-null/non-zero |

### 8. Reading Uninitialized Memory

Reading uninitialized bytes for types whose validity requires initialization. Only permitted in `union` fields and struct padding bytes.

### 9. Compiler Intrinsic Undefined Behavior

Calling `core::intrinsics` functions in ways that violate their documented preconditions.

### 10. Unsupported Platform Features

Executing code compiled with `#[target_feature]` on a platform that does not support those features, unless explicitly documented as safe.

### 11. Wrong Call ABI

- Calling a function through a function pointer of the wrong type or ABI.
- Unwinding through a frame that does not support unwinding (e.g., calling a `"C-unwind"` function as `"C"` while panicking).

### 12. Incorrect Inline Assembly

Violating any of the rules for `asm!` / `naked_asm!`. See [inline-assembly.md](./inline-assembly.md).

### 13. Runtime Assumption Violations

- Destructors of local variables not executing (e.g., via `longjmp`).
- Unwinding across FFI boundaries incorrectly.
- FFI functions like `longjmp` deallocating Rust stack frames.

---

## Undefined Behavior in Const Contexts

Additional provenance rules apply during const evaluation:

- Pure integer types (`i*`, `u*`, `f*`, `bool`, `char`, enum discriminants, slice metadata) must **not carry pointer provenance**.
- Pointer types (references, raw pointers, function pointers, `dyn Trait` metadata) must have all bytes from the same original pointer, in the correct order.

```rust
// UB: reading pointer bytes as integers
const _: usize = unsafe { (&raw const ptr as *const usize).read() };
```

---

## Important Notes

- The list is **not exhaustive** — it may grow or shrink as the memory model is formalized.
- Undefined behavior affects the **entire program**, including code in other languages linked to Rust.
- **Sound unsafe code**: safe callers cannot trigger UB through the safe API.
- Run programs under [`miri`](https://github.com/rust-lang/miri) to detect many forms of UB dynamically.
- Read [The Rustonomicon](https://doc.rust-lang.org/nomicon/) before writing `unsafe` Rust.

## Related

- [unsafety.md](./unsafety.md)
- [memory-model.md](./memory-model.md)
- [inline-assembly.md](./inline-assembly.md)
- [type-system.md](./type-system.md)
