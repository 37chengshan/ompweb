# Ownership

Rust's ownership system provides complete memory safety without a garbage collector. It is built on three interacting mechanisms: ownership/moves, borrows (references), and lifetimes.

## Signature / Usage

```rust
// Ownership and moves
let s1 = String::from("hello");
let s2 = s1;        // s1 is moved; s1 is no longer valid
// println!("{s1}"); // ERROR: use of moved value

// Immutable borrow
let data = vec![1, 2, 3];
let x = &data[0];   // shared reference; data is "frozen"
println!("{x}");
// data.push(4);     // ERROR: cannot mutate while borrowed

// Mutable borrow (exclusive)
let mut v = vec![1, 2, 3];
let r = &mut v;
r.push(4);
// let r2 = &v;      // ERROR: cannot alias a mutable reference

// Lifetime annotation (function boundary)
fn longest<'a>(x: &'a str, y: &'a str) -> &'a str {
    if x.len() > y.len() { x } else { y }
}
```

## Ownership Rules

1. Every value has exactly one owner.
2. When the owner goes out of scope, the value is dropped.
3. Ownership can be transferred (moved) but not duplicated (unless `Copy`).

## Borrowing Rules (enforced by the borrow checker)

1. A reference cannot outlive its referent.
2. At any time, you may have **either** any number of shared (`&T`) references **or** exactly one exclusive (`&mut T`) reference — never both simultaneously.

## Lifetimes

- A reference's lifetime spans from creation to its last use (not necessarily end of scope).
- The borrow checker uses lifetime annotations at function boundaries to verify that returned references do not outlive their sources.
- **Elision rules** automatically infer lifetimes in common cases:
  1. Each elided input lifetime becomes a distinct parameter.
  2. If exactly one input lifetime, it is applied to all outputs.
  3. If `&self` / `&mut self` is present, its lifetime is applied to all outputs.

## Notes

- **Subtyping and variance**: `&'long T` is a subtype of `&'short T` (longer lifetimes are subtypes of shorter ones). `&mut T` is **invariant** over `T` to prevent use-after-free via aliased mutable references. `&T` is **covariant** over `T`.
- **Destructor extends lifetime**: if a struct holds a reference and implements `Drop`, the borrow lasts until after `drop` is called, which can prevent otherwise-valid operations.
- **Borrow checker limitations**: some logically correct programs are rejected (e.g., `HashMap::get_default` patterns) because the checker extends borrows conservatively. Using raw pointers or restructuring code is sometimes necessary.
- **Non-lexical lifetimes (NLL)**: the borrow checker tracks lifetimes to the last use, not end of scope — `data.push(4)` is allowed after `println!("{x}")` if `x` is no longer used.

## Related

- [meet-safe-and-unsafe.md](./meet-safe-and-unsafe.md)
- [uninitialized.md](./uninitialized.md)
- [ownership-based-resource-management.md](./ownership-based-resource-management.md)
