# Scoping Rules

Scopes determine when resources are freed (RAII), when borrows are valid, and when lifetimes start and end. These rules underpin Rust's memory safety guarantees without a garbage collector.

## RAII — Automatic Resource Management

```rust
fn create_box() {
    let _b = Box::new(3i32);
    // `_b` dropped here — heap memory freed automatically
}

fn main() {
    let _box2 = Box::new(5i32);
    {
        let _box3 = Box::new(4i32);
    } // _box3 dropped here
    // _box2 dropped at end of main
}
```

Implement the `Drop` trait for custom cleanup:

```rust
struct MyResource;
impl Drop for MyResource {
    fn drop(&mut self) { println!("dropped!"); }
}
```

## Ownership and Moves

```rust
fn main() {
    let s1 = String::from("hello");
    let s2 = s1; // s1 is moved — no longer valid
    // println!("{}", s1); // error: value used after move

    // Copy types (integers, bool, etc.) are copied, not moved
    let x = 5;
    let y = x; // x is still valid
}
```

## Borrowing

```rust
fn borrow(s: &String) {          // immutable borrow
    println!("{}", s);
}

fn borrow_mut(s: &mut String) {  // mutable borrow
    s.push_str(" world");
}

fn main() {
    let mut s = String::from("hello");
    borrow(&s);       // s still owned here
    borrow_mut(&mut s);
    println!("{}", s);
}
```

Borrow rules (enforced at compile time):
- Any number of **immutable** borrows at once, OR
- Exactly **one mutable** borrow — never both simultaneously.

## Lifetimes

Lifetime annotations describe how long references are valid. The compiler infers most lifetimes automatically (elision rules).

```rust
// Explicit lifetime: 'a means both inputs and output live at least as long as 'a
fn longest<'a>(x: &'a str, y: &'a str) -> &'a str {
    if x.len() > y.len() { x } else { y }
}

fn main() {
    let s1 = String::from("long");
    let result;
    {
        let s2 = String::from("xyz");
        result = longest(s1.as_str(), s2.as_str());
        println!("{}", result); // OK — both live here
    }
}
```

## Notes

- Stack values that implement `Copy` are copied on assignment; heap-owning values are moved.
- A dangling reference is a compile error — the borrow checker rejects code where a reference outlives its referent.
- `'static` lifetime means a reference is valid for the entire program duration (e.g., string literals).
- Lifetime elision rules: most `&self`/`&mut self` methods have lifetimes inferred automatically.

## Related

- [04-variable-bindings.md](./04-variable-bindings.md)
- [14-generics.md](./14-generics.md)
- [19-std-library-types.md](./19-std-library-types.md)
