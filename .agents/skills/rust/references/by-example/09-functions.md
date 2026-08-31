# Functions

Functions are declared with `fn`. Arguments must be type-annotated; the return type follows `->`. The final expression is returned implicitly (no `return` needed). Closures are anonymous functions that can capture their environment.

## Basic Functions

```rust
fn is_divisible(lhs: u32, rhs: u32) -> bool {
    if rhs == 0 { return false; } // early return
    lhs % rhs == 0                // implicit return
}

fn fizzbuzz(n: u32) { // returns () implicitly
    if is_divisible(n, 15)      { println!("fizzbuzz"); }
    else if is_divisible(n, 3)  { println!("fizz"); }
    else if is_divisible(n, 5)  { println!("buzz"); }
    else                        { println!("{}", n); }
}

fn main() {
    for n in 1..=20 { fizzbuzz(n); }
}
```

## Closures

```rust
fn main() {
    let outer = 42;

    // Type annotations are optional — inferred from usage
    let add = |i: i32| -> i32 { i + outer };
    let add_inferred = |i| i + outer;

    println!("{}", add(1));          // 43
    println!("{}", add_inferred(1)); // 43

    // Closures as arguments: Fn, FnMut, FnOnce
    fn apply<F: Fn()>(f: F) { f(); }
    apply(|| println!("called!"));
}
```

## Methods

```rust
struct Rectangle { width: f64, height: f64 }

impl Rectangle {
    // Associated function (no self)
    fn new(w: f64, h: f64) -> Self {
        Rectangle { width: w, height: h }
    }

    // Method (takes &self)
    fn area(&self) -> f64 {
        self.width * self.height
    }
}

fn main() {
    let r = Rectangle::new(3.0, 4.0);
    println!("area = {}", r.area());
}
```

## Higher-Order Functions

```rust
fn main() {
    // Iterator combinators
    let sum: u32 = (1..=10)
        .filter(|x| x % 2 == 0)
        .map(|x| x * x)
        .sum();
    println!("{}", sum); // 220
}
```

## Diverging Functions

```rust
// Never returns; return type is `!`
fn diverge() -> ! {
    panic!("This function never returns");
}
```

## Notes

- Function definition order does not matter in Rust (unlike C).
- Closures capture by reference by default; use `move` to capture by value.
- `Fn`: borrows immutably; `FnMut`: borrows mutably; `FnOnce`: takes ownership (can only be called once).
- Returning closures from functions requires `impl Fn(...)` or `Box<dyn Fn(...)>`.

## Related

- [07-expressions.md](./07-expressions.md)
- [14-generics.md](./14-generics.md)
- [16-traits.md](./16-traits.md)
