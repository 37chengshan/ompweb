# Compiler Error Index Overview

The Rust compiler (rustc) emits structured error codes in the format **E followed by a four-digit number** (e.g., `E0382`, `E0597`). Every error code links to a detailed explanation with code examples and fix guidance.

## Looking Up Errors

```bash
# Print a full explanation for a specific error code in the terminal
rustc --explain E0382

# Compile and see error codes inline
rustc src/main.rs
# => error[E0382]: borrow of moved value ...
```

Online reference: <https://doc.rust-lang.org/error_codes/index.html>

Individual error pages follow the pattern:
```
https://doc.rust-lang.org/error_codes/E0382.html
```

## Error Code Ranges and Categories

Error codes are not strictly grouped by range, but broad tendencies exist:

| Range | Common topics |
|-------|---------------|
| E0001–E0099 | Pattern matching, syntax, basic compilation |
| E0100–E0299 | Type system, traits, lifetimes, generics |
| E0300–E0499 | Modules, imports, visibility, borrow checker |
| E0500–E0599 | Ownership, borrowing, lifetime conflicts |
| E0600–E0699 | Method resolution, type coercion, attributes |
| E0700–E0806 | Async/await, const generics, unsafe, advanced features |

Gaps in numbering indicate codes that were removed or retired in earlier compiler versions.

## Representative Common Errors

### Ownership and Borrowing

**E0382 — use of moved value**
A non-`Copy` value was used after ownership was transferred to another binding.
```rust
let s = String::from("hello");
let t = s;   // s moved here
println!("{}", s); // error[E0382]
```
Fix: clone the value, use references, or restructure ownership.

---

**E0499 — cannot borrow as mutable more than once**
Two simultaneous `&mut` references to the same variable are not allowed.
```rust
let mut v = vec![1];
let a = &mut v;
let b = &mut v; // error[E0499]
```

---

**E0502 — cannot borrow as mutable because it is also borrowed as immutable**
An immutable borrow (`&T`) and a mutable borrow (`&mut T`) cannot coexist.
```rust
let mut s = String::from("hi");
let r = &s;
s.push('!'); // error[E0502]: cannot borrow `s` as mutable
println!("{}", r);
```

---

**E0507 — cannot move out of borrowed content**
Attempting to move a value out of a shared or mutable reference.
```rust
fn consume(s: String) {}
fn bad(r: &String) {
    consume(*r); // error[E0507]
}
```
Fix: clone the value or change the method to take `&self`.

---

### Lifetimes

**E0106 — missing lifetime specifier**
A reference in a struct field, type alias, or function return type requires an explicit lifetime when the compiler cannot infer one.
```rust
struct Ref { x: &bool } // error[E0106]
struct Ref<'a> { x: &'a bool } // ok
```

---

**E0515 — cannot return reference to local variable**
Returning a reference to a value that will be dropped at the end of the function.
```rust
fn bad() -> &i32 {
    let x = 42;
    &x // error[E0515]
}
```
Fix: return the owned value, or accept the input as a reference and return it.

---

**E0597 — borrowed value does not live long enough**
A value is dropped while a reference to it is still in use.
```rust
let r;
{
    let x = 5;
    r = &x; // error[E0597]: `x` does not live long enough
}
println!("{}", r);
```

---

**E0716 — temporary value dropped while borrowed**
A temporary produced by an expression is freed at the end of its statement, invalidating an active borrow.
```rust
let r = &vec![1, 2, 3][0]; // error[E0716]: temporary dropped here
```
Fix: bind the temporary to a named variable first.

---

### Type System and Traits

**E0277 — trait bound not satisfied**
A type used in a generic context does not implement a required trait.
```rust
fn print<T: std::fmt::Display>(v: T) { println!("{}", v); }
struct Opaque;
print(Opaque); // error[E0277]: `Opaque` doesn't implement `Display`
```

---

**E0308 — mismatched types**
The type of an expression does not match what the compiler expected.
```rust
fn add_one(x: i32) -> i32 { x + 1 }
add_one("oops"); // error[E0308]: expected `i32`, found `&str`
```

---

**E0207 — type parameter not constrained by impl**
A generic parameter in an `impl` block does not appear in the self type or trait being implemented.
```rust
struct Foo;
impl<T: Default> Foo { // error[E0207]: T is unconstrained
    fn get(&self) -> T { T::default() }
}
```
Fix: move the parameter to the method signature instead.

---

### Pattern Matching

**E0004 — non-exhaustive patterns**
A `match` expression does not cover all possible variants of the matched type.
```rust
enum Dir { Left, Right }
let d = Dir::Left;
match d {
    Dir::Left => {} // error[E0004]: `Right` not covered
}
```
Fix: add the missing arms or use a wildcard `_`.

---

### Traits and Implementations

**E0046 — not all trait items implemented**
An `impl` block is missing one or more required methods, associated types, or constants from the trait definition.
```rust
trait Greet { fn hello(&self); }
struct Bot;
impl Greet for Bot {} // error[E0046]: missing `hello`
```

## Notes

- The compiler often suggests a fix directly in the error output. Read it before consulting the index.
- `rustc --explain <CODE>` works offline and always matches the installed compiler version.
- The `error_codes` book is also available locally via `rustup doc --reference` (scroll to "Error codes").
- Some codes (e.g., E0001, E0002) are historical and now rarely emitted; others like E0382, E0308, E0277 are among the most frequently encountered.

## Related

- [README](./README.md)
