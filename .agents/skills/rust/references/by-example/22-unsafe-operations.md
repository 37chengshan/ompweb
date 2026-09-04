# Unsafe Operations

The `unsafe` keyword lets you bypass Rust's safety guarantees for operations the compiler cannot verify. Minimize unsafe code and carefully document invariants.

## What Requires unsafe

1. Dereferencing raw pointers
2. Calling unsafe functions or methods
3. Accessing or modifying mutable static variables
4. Implementing unsafe traits

## Raw Pointers

```rust
fn main() {
    let raw: *const u32 = &10;

    unsafe {
        assert!(*raw == 10);
        println!("{}", *raw);
    }
}
```

Raw pointer types: `*const T` (immutable) and `*mut T` (mutable). Creating raw pointers is safe; dereferencing them requires `unsafe`.

## Calling Unsafe Functions

```rust
use std::slice;

fn main() {
    let v = vec![1u32, 2, 3, 4];
    let ptr = v.as_ptr();
    let len = v.len();

    unsafe {
        // Caller must guarantee: ptr is valid, len is correct, alignment is right
        let s: &[u32] = slice::from_raw_parts(ptr, len);
        assert_eq!(v.as_slice(), s);
    }
}
```

## Mutable Static Variables

```rust
static mut COUNTER: u32 = 0;

fn increment() {
    unsafe { COUNTER += 1; }
}

fn main() {
    increment();
    unsafe { println!("{}", COUNTER); }
}
```

## FFI — Calling C Functions

```rust
extern "C" {
    fn abs(input: i32) -> i32;
}

fn main() {
    unsafe {
        println!("{}", abs(-3)); // 3
    }
}
```

Expose Rust functions to C:

```rust
#[no_mangle]
pub extern "C" fn my_rust_fn(x: i32) -> i32 { x * 2 }
```

## Unsafe Traits

```rust
unsafe trait MyUnsafeTrait {
    fn dangerous(&self);
}

struct Foo;

unsafe impl MyUnsafeTrait for Foo {
    fn dangerous(&self) { println!("danger!"); }
}
```

## Notes

- Prefer safe abstractions: wrap `unsafe` blocks in safe public APIs.
- Undefined behavior in `unsafe` blocks is still undefined — the compiler can miscompile it.
- Use tools like `Miri` (UB detector) and `sanitizers` to verify unsafe code.
- Common safe wrappers: `std::slice::from_raw_parts` → use `&v[..]`; raw pointer arithmetic → use iterators.

## Related

- [15-scoping-rules.md](./15-scoping-rules.md)
- [20-std-misc.md](./20-std-misc.md)
