# Ownership and Borrowing

Demonstrate move semantics, cloning, and the borrow rules (immutable/mutable references).

```rust
fn main() {
    // Move: ownership transfers to the new binding
    let s1 = String::from("hello");
    let s2 = s1; // s1 is moved — s1 is no longer valid
    println!("{s2}");

    // Clone: explicit deep copy keeps both valid
    let s3 = s2.clone();
    println!("{s2}, {s3}");

    // Immutable borrow: pass a reference to avoid moving
    let len = calculate_length(&s3);
    println!("len of '{s3}' is {len}");

    // Mutable borrow: only one at a time
    let mut s = String::from("hello");
    append_world(&mut s);
    println!("{s}"); // "hello, world"

    // Slice: reference into a contiguous sequence
    let first = first_word(&s);
    println!("first word: {first}");
}

fn calculate_length(s: &String) -> usize {
    s.len()
} // reference goes out of scope; String is NOT dropped

fn append_world(s: &mut String) {
    s.push_str(", world");
}

fn first_word(s: &str) -> &str {
    let bytes = s.as_bytes();
    for (i, &item) in bytes.iter().enumerate() {
        if item == b' ' {
            return &s[0..i];
        }
    }
    &s[..]
}
```

## Notes

- `String` is heap-allocated; assigning it moves ownership rather than copying.
- Pass `&T` to borrow immutably; pass `&mut T` to borrow mutably — never both at the same time.
- Prefer `&str` over `&String` in function signatures: it accepts both `String` and string literals.
- The borrow checker enforces these rules at compile time with no runtime cost.
