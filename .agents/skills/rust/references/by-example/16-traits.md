# Traits

A trait defines a set of methods for an unknown type `Self`. Any type can implement a trait; traits enable polymorphism and shared behavior across types.

## Defining and Implementing Traits

```rust
trait Animal {
    fn new(name: &'static str) -> Self;
    fn name(&self) -> &'static str;
    fn noise(&self) -> &'static str;

    // Default implementation
    fn talk(&self) {
        println!("{} says {}", self.name(), self.noise());
    }
}

struct Dog { name: &'static str }

impl Animal for Dog {
    fn new(name: &'static str) -> Dog { Dog { name } }
    fn name(&self) -> &'static str { self.name }
    fn noise(&self) -> &'static str { "woof!" }
    // talk() inherited from default
}

fn main() {
    let d: Dog = Animal::new("Rex");
    d.talk(); // Rex says woof!
}
```

## derive — Auto-implement Standard Traits

```rust
#[derive(Debug, Clone, PartialEq, PartialOrd)]
struct Point { x: f64, y: f64 }
```

Derivable traits: `Debug`, `Clone`, `Copy`, `PartialEq`, `Eq`, `PartialOrd`, `Ord`, `Hash`, `Default`.

## Operator Overloading

```rust
use std::ops::Add;

#[derive(Debug)]
struct Vec2 { x: f64, y: f64 }

impl Add for Vec2 {
    type Output = Vec2;
    fn add(self, other: Vec2) -> Vec2 {
        Vec2 { x: self.x + other.x, y: self.y + other.y }
    }
}
```

## impl Trait — Return Trait Objects

```rust
fn make_adder(x: i32) -> impl Fn(i32) -> i32 {
    move |y| x + y
}

fn main() {
    let add5 = make_adder(5);
    println!("{}", add5(3)); // 8
}
```

## Supertraits

```rust
trait Printable: std::fmt::Display {
    fn print(&self) { println!("{}", self); }
}
```

## Disambiguating Overlapping Traits

```rust
trait UsernameWidget { fn get(&self) -> String; }
trait AgeWidget     { fn get(&self) -> u8; }

struct Form;
impl UsernameWidget for Form { fn get(&self) -> String { "Alice".into() } }
impl AgeWidget for Form     { fn get(&self) -> u8 { 30 } }

fn main() {
    let form = Form;
    // Fully-qualified syntax to disambiguate
    println!("{}", <Form as UsernameWidget>::get(&form));
    println!("{}", <Form as AgeWidget>::get(&form));
}
```

## Notes

- `dyn Trait` is a trait object for dynamic dispatch; `impl Trait` is static dispatch.
- The `Iterator` trait (`next() -> Option<Self::Item>`) powers Rust's iterator combinators.
- `Drop` trait: implement `drop(&mut self)` for custom cleanup when a value goes out of scope.
- `Clone` requires explicit `.clone()` call; `Copy` enables implicit bitwise copy for small types.

## Related

- [14-generics.md](./14-generics.md)
- [06-conversion.md](./06-conversion.md)
- [09-functions.md](./09-functions.md)
