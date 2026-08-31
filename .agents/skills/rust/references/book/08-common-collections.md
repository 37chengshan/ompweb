# Chapter 8: Common Collections

Heap-allocated collections that can grow and shrink at runtime: vectors, strings, and hash maps.

## Vec\<T\> — Vectors

```rust
// Creation
let v: Vec<i32> = Vec::new();
let v = vec![1, 2, 3];         // type inferred

// Updating
let mut v = Vec::new();
v.push(5);

// Reading elements
let third: &i32 = &v[2];           // panics if out of bounds
let third: Option<&i32> = v.get(2); // safe: returns None

// Iterating
for i in &v { println!("{i}"); }
for i in &mut v { *i += 50; }      // dereference to modify

// Storing multiple types via enum
enum Cell { Int(i32), Text(String) }
let row = vec![Cell::Int(3), Cell::Text(String::from("blue"))];
```

- Freed when the vector goes out of scope, dropping all elements.
- Cannot hold an immutable reference while also mutating the vector (borrow rules apply).

## String

```rust
// Creation
let mut s = String::new();
let s = String::from("hello");
let s = "hello".to_string();

// Updating
s.push_str(" world"); // appends &str; doesn't take ownership
s.push('!');          // single char

// Concatenation
let s1 = String::from("Hello, ");
let s2 = String::from("world!");
let s3 = s1 + &s2;  // s1 is moved; s2 borrowed
let s = format!("{s2}-{s3}"); // doesn't take ownership of any arg

// Iterating — strings cannot be indexed with [0]
for c in "Зд".chars() { println!("{c}"); }  // Unicode scalar values
for b in "Зд".bytes() { println!("{b}"); }  // raw bytes
```

Why indexing is not allowed:
- UTF-8 characters vary in byte length (1–4 bytes).
- `"hello"[0]` would return the first **byte** (`104`), not a character.
- Rust guarantees O(1) indexing; scanning for character boundaries would violate that.

Use `&s[0..4]` (byte ranges) with caution — panics if the range falls inside a multi-byte character.

## HashMap\<K, V\>

```rust
use std::collections::HashMap;

let mut scores: HashMap<String, i32> = HashMap::new();
scores.insert(String::from("Blue"), 10);

// Access
let score = scores.get("Blue").copied().unwrap_or(0);

// Iterate
for (key, value) in &scores { println!("{key}: {value}"); }

// Update patterns
scores.insert(String::from("Blue"), 25); // overwrite

// Insert only if key absent
scores.entry(String::from("Yellow")).or_insert(50);

// Update based on old value
let count = map.entry(word).or_insert(0);
*count += 1;
```

- HashMap is not in the prelude; must `use std::collections::HashMap`.
- Owned values (like `String`) are **moved** into the map; `Copy` types are copied.
- All keys must be the same type; all values must be the same type.
- Default hash function is SipHash (DoS-resistant but not the fastest).

## Notes

- Prefer `v.get(i)` over `&v[i]` when out-of-bounds is possible.
- `String` is a `Vec<u8>` wrapper — all `Vec` performance characteristics apply.
- For grapheme clusters (user-perceived characters), use a crate from crates.io.

## Related

- [Chapter 7: Packages, Crates, and Modules](./07-packages-crates-modules.md)
- [Chapter 9: Error Handling](./09-error-handling.md)
- [Chapter 13: Iterators and Closures](./13-iterators-closures.md)
