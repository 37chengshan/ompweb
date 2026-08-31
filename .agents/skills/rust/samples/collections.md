# Collections

Work with the three most common standard-library collections: `Vec<T>`, `String`, and `HashMap<K, V>`.

```rust
use std::collections::HashMap;

fn main() {
    // --- Vec<T> ---
    let mut v: Vec<i32> = Vec::new();
    v.push(1);
    v.push(2);
    v.push(3);

    let third: Option<&i32> = v.get(2); // safe access — returns None if out of bounds
    println!("third: {third:?}");

    for x in &mut v { *x *= 2; } // mutable iteration
    println!("doubled: {v:?}");

    // --- String ---
    let mut s = String::from("hello");
    s.push_str(", world"); // appends &str; does not take ownership
    s.push('!');
    let s2 = format!("{s} ({} chars)", s.len()); // format! doesn't move any arg
    println!("{s2}");

    // Iterate over Unicode chars (indexing by byte position is not allowed)
    for c in "Здравствуйте".chars().take(3) {
        print!("{c} ");
    }
    println!();

    // --- HashMap<K, V> ---
    let mut scores: HashMap<String, i32> = HashMap::new();
    scores.insert(String::from("Alice"), 10);
    scores.insert(String::from("Bob"), 20);

    // Access
    let alice_score = scores.get("Alice").copied().unwrap_or(0);
    println!("Alice: {alice_score}");

    // Insert only if absent
    scores.entry(String::from("Carol")).or_insert(15);

    // Update based on existing value
    let e = scores.entry(String::from("Alice")).or_insert(0);
    *e += 5; // Alice: 15

    for (name, score) in &scores {
        println!("{name}: {score}");
    }
}
```

## Notes

- Use `v.get(i)` instead of `&v[i]` when out-of-bounds access is possible; it returns `Option<&T>`.
- `String` is a `Vec<u8>` wrapper; UTF-8 encoding means byte-index access (`s[0]`) is not allowed.
- `HashMap` is not in the prelude; always `use std::collections::HashMap`.
- Owned values inserted into a `HashMap` are moved; `Copy` types are copied.
