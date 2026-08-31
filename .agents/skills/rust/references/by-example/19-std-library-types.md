# Std Library Types

The standard library provides essential types beyond primitives: `Box`, `Vec`, `String`, `Option`, `Result`, `HashMap`, `HashSet`, `Rc`, and `Arc`.

## Box\<T\> — Heap Allocation

```rust
fn main() {
    // Allocate on heap
    let boxed: Box<i32> = Box::new(5);
    let val: i32 = *boxed; // dereference

    // Box enables recursive types
    #[derive(Debug)]
    enum List {
        Cons(i32, Box<List>),
        Nil,
    }
    let list = List::Cons(1, Box::new(List::Cons(2, Box::new(List::Nil))));
}
```

## Vec\<T\> — Growable Array

```rust
fn main() {
    let mut v: Vec<i32> = Vec::new();
    v.push(1); v.push(2); v.push(3);

    // Macro shorthand
    let v = vec![1, 2, 3];

    println!("{}", v[0]);        // 1
    println!("{:?}", &v[1..]);   // [2, 3]
    println!("{}", v.len());     // 3
}
```

## String — Growable UTF-8 String

```rust
fn main() {
    let mut s = String::new();
    s.push_str("hello");
    s.push(' ');
    s += "world";

    let literal: &str = "slice";
    let owned: String = literal.to_string();

    println!("{}", s.len()); // byte length
}
```

## HashMap\<K, V\>

```rust
use std::collections::HashMap;

fn main() {
    let mut scores: HashMap<&str, i32> = HashMap::new();
    scores.insert("Alice", 10);
    scores.insert("Bob",   20);

    // Entry API — insert if absent
    scores.entry("Alice").or_insert(50); // no change
    scores.entry("Carol").or_insert(50); // inserts 50

    if let Some(score) = scores.get("Alice") {
        println!("{}", score); // 10
    }

    for (name, score) in &scores {
        println!("{}: {}", name, score);
    }
}
```

## HashSet\<T\>

```rust
use std::collections::HashSet;

fn main() {
    let mut a: HashSet<i32> = [1, 2, 3].iter().cloned().collect();
    let b: HashSet<i32> = [2, 3, 4].iter().cloned().collect();

    let union: HashSet<_> = a.union(&b).collect();
    let inter: HashSet<_> = a.intersection(&b).collect();
}
```

## Rc\<T\> — Reference Counting (single-threaded)

```rust
use std::rc::Rc;

fn main() {
    let a = Rc::new(5);
    let b = Rc::clone(&a);      // increments count
    println!("count = {}", Rc::strong_count(&a)); // 2
}
```

## Arc\<T\> — Atomic Reference Counting (multi-threaded)

```rust
use std::sync::Arc;
use std::thread;

fn main() {
    let val = Arc::new(42);
    let val2 = Arc::clone(&val);
    let handle = thread::spawn(move || println!("{}", val2));
    handle.join().unwrap();
}
```

## Notes

- `Box` is for single ownership + heap allocation; use when size is unknown at compile time.
- `Rc` for multiple owners in single-threaded code; `Arc` for multi-threaded.
- `HashMap` is unordered; use `BTreeMap` for sorted keys.
- `String` owns its data; `&str` is a borrowed string slice.
- `Vec` is backed by a contiguous heap allocation; `&[T]` is a borrowed slice.

## Related

- [15-scoping-rules.md](./15-scoping-rules.md)
- [18-error-handling.md](./18-error-handling.md)
- [20-std-misc.md](./20-std-misc.md)
