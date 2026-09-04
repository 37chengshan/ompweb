# Chapter 13: Functional Language Features — Iterators and Closures

Closures are anonymous functions that capture their environment; iterators provide lazy, composable sequence processing.

## Closures

```rust
// Syntax variants (all equivalent for a simple add-one)
let add_one = |x: u32| -> u32 { x + 1 };  // fully annotated
let add_one = |x| x + 1;                  // types inferred

// Closures capture their environment
let offset = 5;
let add_offset = |x| x + offset;  // captures `offset` by immutable borrow
```

### Capture modes

```rust
let list = vec![1, 2, 3];

// Immutable borrow (default when only reading)
let borrows = || println!("{list:?}");
borrows();
println!("{list:?}"); // list still accessible

// Mutable borrow
let mut list = vec![1, 2, 3];
let mut appends = || list.push(7);
appends();

// Ownership transfer with move (required for threads)
use std::thread;
let list = vec![1, 2, 3];
thread::spawn(move || println!("{list:?}")).join().unwrap();
```

### Fn traits

| Trait | How closure uses captured values |
|-------|----------------------------------|
| `FnOnce` | May move captured values out; callable once |
| `FnMut` | Mutates captured values; callable multiple times |
| `Fn` | Only reads captured values; callable multiple times |

`FnOnce` is the most permissive bound (accepts all closures); use it when a closure is called once. `sort_by_key` requires `FnMut`.

## Iterators

All iterators implement the `Iterator` trait:

```rust
pub trait Iterator {
    type Item;
    fn next(&mut self) -> Option<Self::Item>;
}
```

Iterators are **lazy** — no computation until consumed.

### Creating iterators

```rust
let v = vec![1, 2, 3];
v.iter()       // &T (immutable references)
v.iter_mut()   // &mut T (mutable references)
v.into_iter()  // T (takes ownership)
```

### Iterator adapters (lazy, return new iterators)

```rust
v.iter().map(|x| x + 1)           // transform each element
v.iter().filter(|&&x| x > 1)      // keep matching elements
v.iter().zip(other.iter())         // pair two iterators
v.iter().enumerate()               // (index, &value) pairs
v.iter().take(3)                   // first N elements
v.iter().skip(2)                   // skip N elements
v.iter().flat_map(|x| vec![x, x]) // flatten one level
```

### Consuming adaptors (call next, produce a value)

```rust
let sum: i32 = v.iter().sum();
let product: i32 = v.iter().product();
let collected: Vec<i32> = v.iter().map(|x| x + 1).collect();
let count = v.iter().count();
let any_positive = v.iter().any(|&x| x > 0);
let all_positive = v.iter().all(|&x| x > 0);
```

### Chaining

```rust
let result: Vec<String> =
    shoes.into_iter()
         .filter(|s| s.size == shoe_size)
         .map(|s| s.style.clone())
         .collect();
```

### Custom iterator

```rust
struct Counter { count: u32 }
impl Iterator for Counter {
    type Item = u32;
    fn next(&mut self) -> Option<u32> {
        if self.count < 5 { self.count += 1; Some(self.count) }
        else { None }
    }
}
```

## Notes

- Iterator adaptors produce no output until consumed with a consuming adaptor — forgetting to consume is a common mistake.
- Iterators are generally as fast as or faster than manual loops (zero-cost abstraction via inlining).
- `collect()` requires a type annotation (e.g., `Vec<_>`) because it can produce many collection types.
- Returning a closure: use `impl Fn(i32) -> i32` for a single type, or `Box<dyn Fn(i32) -> i32>` when multiple different closures may be returned.

## Related

- [Chapter 12: I/O Project](./12-io-project.md)
- [Chapter 15: Smart Pointers](./15-smart-pointers.md)
- [Chapter 17: Async and Await](./17-async-await.md)
