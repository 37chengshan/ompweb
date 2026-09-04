# Special Types and Traits

Certain types and traits receive special compiler treatment beyond ordinary library code.

## Special Types

### `Box<T>`

- The `*` dereference operator on `Box<T>` produces a place that can be moved from (built into the language).
- Methods can declare `self: Box<Self>` as a receiver type.
- The orphan rule allows implementing a trait for `Box<T>` in the same crate as `T`.

### `Rc<T>`

- Methods can declare `self: Rc<Self>` as a receiver type.
- Single-threaded reference counting.

### `Arc<T>`

- Methods can declare `self: Arc<Self>` as a receiver type.
- Thread-safe, atomic reference counting.

### `Pin<P>`

- Methods can declare `self: Pin<P>` (where `P` is `&Self`, `&mut Self`, etc.) as a receiver type.
- Prevents the pinned value from being moved.

### `UnsafeCell<T>`

- The only way to legally obtain shared mutable access through `&T` (interior mutability).
- Disables the compiler's aliasing-related optimizations for the contained value.
- Prevents `static` items with interior mutability from being placed in read-only memory.
- `&mut UnsafeCell<T>` aliasing is still undefined behavior.

### `PhantomData<T>`

- Zero-sized, minimum-alignment type.
- Treated as logically owning a `T` for variance, drop check, and auto trait purposes.

```rust
use std::marker::PhantomData;

struct MySlice<'a, T> {
    ptr: *const T,
    len: usize,
    _marker: PhantomData<&'a T>,  // covariant in 'a and T
}
```

---

## Special Traits

### `Copy`

- Values are **copied** (bitwise) instead of moved.
- Cannot be implemented for types that implement `Drop`.
- All fields must also be `Copy`.
- Auto-implemented for: tuples of `Copy` types, function pointers, function items, closures capturing only `Copy` values.

```rust
#[derive(Copy, Clone)]
struct Point { x: f64, y: f64 }
```

### `Clone`

- Supertrait of `Copy`.
- Provides explicit `.clone()` method.
- Auto-implemented for types that are `Copy`, tuples of `Clone` types, closures capturing `Clone` values.

### `Drop`

- Provides a destructor that runs when the value goes out of scope.
- If a type implements `Drop`, it cannot implement `Copy`.
- Destructors run in reverse order of construction; struct fields drop in declaration order.

```rust
impl Drop for MyResource {
    fn drop(&mut self) {
        println!("Dropping MyResource");
    }
}
```

### `Deref` and `DerefMut`

- Overload the `*` operator.
- Enable **deref coercions**: `&Box<T>` → `&T`, `&String` → `&str`, etc.
- Used in method resolution to automatically dereference receivers.

### `Send`

- Marks a type as safe to **transfer** between threads.
- Raw pointers are `!Send` by default.
- Auto trait: automatically derived from field types.

### `Sync`

- Marks a type as safe to **share** between threads via `&T`.
- Equivalent to: `T: Sync` iff `&T: Send`.
- Required for `static` items accessed from multiple threads.
- Auto trait.

### `Sized`

- Indicates the type has a size known at compile time.
- Automatically implemented by the compiler; cannot be implemented manually.
- Type parameters and associated types are implicitly `Sized` unless relaxed with `?Sized`.

### `Termination`

- Return type of `main` and test functions must implement `Termination`.
- Implemented by `()`, `!`, `Infallible`, `ExitCode`, and `Result<T: Termination, E: Debug>`.

---

## Auto Traits

Auto traits are implemented automatically by the compiler based on field types. They can have negative implementations.

**Auto traits**: `Send`, `Sync`, `Unpin`, `UnwindSafe`, `RefUnwindSafe`

### Automatic Implementation Rules

1. **References and pointers**: `&T`, `&mut T`, `*const T`, `*mut T` implement the trait if `T` does (with exceptions, e.g., `*mut T: !Send`).
2. **Arrays and slices**: `[T; N]` and `[T]` implement the trait if `T` does.
3. **Aggregates**: struct, enum, union, tuple implement the trait if all fields do.
4. **Closures**: implement the trait if all captured values do.

### Negative Implementations

```rust
// *mut T is !Send even if T: Send
impl<T> !Send for *mut T {}
```

### On Trait Objects

Auto traits can be added as bounds on trait objects:

```rust
Box<dyn Debug + Send + UnwindSafe>
```

---

## Notes

- `UnsafeCell<T>` is the only permitted way to achieve interior mutability; other approaches are undefined behavior.
- `PhantomData<T>` is essential for correct variance in raw-pointer-based data structures.
- `Deref` coercions apply transitively (e.g., `Box<String>` coerces to `&str`).

## Related

- [type-system.md](./type-system.md)
- [memory-model.md](./memory-model.md)
- [unsafety.md](./unsafety.md)
