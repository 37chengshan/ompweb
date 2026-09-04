# Chapter 4: Understanding Ownership

Rust's core memory-management feature: ownership, borrowing, and slices — enabling memory safety without a garbage collector.

## Ownership Rules

1. Each value has exactly one **owner**.
2. There can be only **one owner at a time**.
3. When the owner goes **out of scope**, the value is **dropped** (memory freed).

## Move vs. Copy

```rust
// Move: heap-allocated types transfer ownership
let s1 = String::from("hello");
let s2 = s1;          // s1 is moved to s2
// println!("{s1}"); // ❌ compile error: s1 invalid

// Clone: explicit deep copy
let s3 = s2.clone();
println!("{s2}, {s3}"); // both valid

// Copy: stack types are trivially copied
let x = 5;
let y = x;            // x is copied, both still valid
println!("{x}, {y}");
```

**Copy types**: integers, floats, `bool`, `char`, tuples of Copy types.

## References and Borrowing

```rust
fn calculate_length(s: &String) -> usize {
    s.len()
} // s goes out of scope but the String is NOT dropped (no ownership)

let s1 = String::from("hello");
let len = calculate_length(&s1); // pass reference with &
```

### Mutable references

```rust
let mut s = String::from("hello");
change(&mut s);

fn change(s: &mut String) {
    s.push_str(", world");
}
```

### Borrowing rules

- At any given time: **either** one mutable reference **or** any number of immutable references — never both simultaneously.
- References must always be valid (no dangling references).

```rust
let mut s = String::from("hello");
let r1 = &s;
let r2 = &s;
println!("{r1} and {r2}"); // last use of r1, r2

let r3 = &mut s; // OK: r1/r2 scopes ended
println!("{r3}");
```

## The Slice Type

Slices are references to a contiguous sequence — they don't own data.

```rust
let s = String::from("hello world");
let hello = &s[0..5];   // &str
let world = &s[6..11];

// String slices in function signatures — preferred over &String
fn first_word(s: &str) -> &str {
    let bytes = s.as_bytes();
    for (i, &item) in bytes.iter().enumerate() {
        if item == b' ' { return &s[0..i]; }
    }
    &s[..]
}

// Array slices
let a = [1, 2, 3, 4, 5];
let slice: &[i32] = &a[1..3]; // [2, 3]
```

## Notes

- Passing a `String` to a function **moves** it unless you pass a reference (`&String` or `&str`).
- Returning a value from a function **moves** ownership to the caller.
- The borrow checker enforces borrowing rules at compile time — no runtime cost.
- Prefer `&str` over `&String` in function parameters for maximum flexibility (works with both `String` and string literals).
- String literal type is `&str` (a slice into the program binary).

## Related

- [Chapter 3: Common Programming Concepts](./03-common-programming-concepts.md)
- [Chapter 5: Using Structs](./05-structs.md)
- [Chapter 10: Generic Types, Traits, and Lifetimes](./10-generic-types-traits-lifetimes.md)
