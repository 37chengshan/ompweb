# Iterators and Closures

Process sequences with lazy iterator adapters and closures that capture their environment.

```rust
fn main() {
    let numbers = vec![1, 2, 3, 4, 5, 6];

    // Closure capturing environment
    let threshold = 3;
    let above: Vec<i32> = numbers
        .iter()
        .filter(|&&x| x > threshold) // borrows threshold
        .map(|&x| x * 2)
        .collect();
    println!("{above:?}"); // [8, 10, 12]

    // Chain of adapters — lazy until collect()
    let sum: i32 = numbers.iter().sum();
    let count = numbers.iter().filter(|&&x| x % 2 == 0).count();
    println!("sum={sum}, even count={count}");

    // enumerate + flat_map
    let words = vec!["hello world", "foo bar"];
    let all_words: Vec<&str> = words
        .iter()
        .flat_map(|s| s.split_whitespace())
        .collect();
    println!("{all_words:?}"); // ["hello", "world", "foo", "bar"]

    // move closure: transfer ownership into a thread
    use std::thread;
    let data = vec![1, 2, 3];
    let handle = thread::spawn(move || println!("{data:?}"));
    handle.join().unwrap();

    // Custom iterator
    let counter = Counter::new();
    let result: u32 = counter.zip(Counter::new().skip(1)).map(|(a, b)| a * b).sum();
    println!("counter result: {result}"); // 2*3 + 3*4 + 4*5 = 38
}

struct Counter { count: u32 }
impl Counter {
    fn new() -> Self { Self { count: 0 } }
}
impl Iterator for Counter {
    type Item = u32;
    fn next(&mut self) -> Option<u32> {
        if self.count < 5 { self.count += 1; Some(self.count) } else { None }
    }
}
```

## Notes

- Iterator adapters are lazy — no computation happens until a consuming adaptor (e.g., `collect`, `sum`, `count`) is called.
- `collect()` needs a type annotation (e.g., `Vec<_>`) because it can produce many collection types.
- Use `move` closures when the closure must outlive the scope where captured variables live (e.g., threads).
- `FnOnce` / `FnMut` / `Fn` bounds describe how a closure uses its captured values; `FnOnce` is the most permissive.
