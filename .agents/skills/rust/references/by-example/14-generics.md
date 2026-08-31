# Generics

Generics allow functions, structs, enums, and traits to operate over multiple types while maintaining type safety. Type parameters are written in angle brackets (`<T>`).

## Generic Functions and Structs

```rust
// Concrete struct
struct A;

// Generic struct — accepts any type T
struct Wrapper<T>(T);

// Generic function
fn largest<T: PartialOrd>(list: &[T]) -> &T {
    let mut largest = &list[0];
    for item in list.iter() {
        if item > largest { largest = item; }
    }
    largest
}

fn main() {
    let w = Wrapper(42i32);
    let w2 = Wrapper("hello");

    let numbers = vec![34, 50, 25, 100, 65];
    println!("{}", largest(&numbers)); // 100
}
```

## Generic Implementations

```rust
struct Pair<T> { first: T, second: T }

impl<T> Pair<T> {
    fn new(first: T, second: T) -> Self {
        Pair { first, second }
    }
}

impl<T: std::fmt::Display + PartialOrd> Pair<T> {
    fn cmp_display(&self) {
        if self.first >= self.second {
            println!("first is larger: {}", self.first);
        } else {
            println!("second is larger: {}", self.second);
        }
    }
}
```

## Trait Bounds and where Clauses

```rust
use std::fmt::Debug;

fn print_if_debug<T: Debug>(val: T) {
    println!("{:?}", val);
}

// Equivalent with where clause (cleaner for multiple bounds)
fn print_both<T, U>(t: T, u: U)
where
    T: Debug,
    U: Debug + Clone,
{
    println!("{:?} {:?}", t, u);
}
```

## Associated Types

```rust
trait Container {
    type Item;
    fn first(&self) -> Option<&Self::Item>;
}

struct Stack<T>(Vec<T>);

impl<T> Container for Stack<T> {
    type Item = T;
    fn first(&self) -> Option<&T> { self.0.first() }
}
```

## Phantom Types

```rust
use std::marker::PhantomData;

// PhantomData<T> marks a type parameter that isn't stored
struct Tagged<T> {
    value: f64,
    _tag: PhantomData<T>,
}
```

## Notes

- Generic type parameters are resolved at compile time — **zero runtime cost** (monomorphization).
- Use `where` clauses when bounds become complex or when the signature would be hard to read.
- `impl Trait` in function position is syntactic sugar for a generic with a trait bound.
- Multiple bounds: `T: Display + Clone`.

## Related

- [16-traits.md](./16-traits.md)
- [15-scoping-rules.md](./15-scoping-rules.md)
