# Chapter 10: Generic Types, Traits, and Lifetimes

Generics eliminate code duplication; traits define shared behavior; lifetimes ensure references remain valid.

## Generic Types

```rust
// Generic function
fn largest<T: PartialOrd>(list: &[T]) -> &T {
    let mut largest = &list[0];
    for item in list {
        if item > largest { largest = item; }
    }
    largest
}

// Generic struct
struct Point<T> { x: T, y: T }
struct Pair<T, U> { x: T, y: U }

// Generic methods
impl<T> Point<T> {
    fn x(&self) -> &T { &self.x }
}

// Implement only for specific type
impl Point<f32> {
    fn distance_from_origin(&self) -> f32 {
        (self.x.powi(2) + self.y.powi(2)).sqrt()
    }
}
```

**Monomorphization**: Rust generates specialized code for each concrete type used — zero runtime cost.

## Traits

```rust
pub trait Summary {
    fn summarize(&self) -> String;           // required method
    fn preview(&self) -> String {            // default implementation
        format!("{}...", &self.summarize()[..20])
    }
}

pub struct Article { pub headline: String, pub author: String }

impl Summary for Article {
    fn summarize(&self) -> String {
        format!("{}, by {}", self.headline, self.author)
    }
}
```

### Trait bounds

```rust
// impl Trait syntax (sugar)
pub fn notify(item: &impl Summary) { println!("{}", item.summarize()); }

// Generic trait bound (explicit)
pub fn notify<T: Summary>(item: &T) { println!("{}", item.summarize()); }

// Multiple bounds
pub fn notify<T: Summary + Display>(item: &T) { }

// where clause (cleaner for many bounds)
fn some_fn<T, U>(t: &T, u: &U)
where
    T: Display + Clone,
    U: Clone + Debug,
{ }

// Returning impl Trait (single concrete type only)
fn returns_summarizable() -> impl Summary { Article { /* ... */ } }
```

The **orphan rule**: you can implement a trait on a type only if either the trait or the type is defined in your crate.

## Lifetimes

Lifetimes describe how long references must be valid. The borrow checker uses them to prevent dangling references.

```rust
// Lifetime annotation: 'a means "at least as long as 'a"
fn longest<'a>(x: &'a str, y: &'a str) -> &'a str {
    if x.len() > y.len() { x } else { y }
}

// Lifetime in structs (struct cannot outlive the reference it holds)
struct ImportantExcerpt<'a> {
    part: &'a str,
}
```

### Lifetime elision rules (compiler infers automatically)

1. Each reference parameter gets its own lifetime.
2. If there is exactly one input lifetime, it is assigned to all output lifetimes.
3. If one of the inputs is `&self` or `&mut self`, its lifetime is assigned to all outputs.

### Static lifetime

```rust
let s: &'static str = "I live for the entire program.";
```

String literals are always `'static`. Don't use `'static` as a quick fix for lifetime errors — fix the root cause instead.

### Combined example

```rust
use std::fmt::Display;

fn longest_with_announcement<'a, T>(
    x: &'a str,
    y: &'a str,
    ann: T,
) -> &'a str
where
    T: Display,
{
    println!("Announcement: {ann}");
    if x.len() > y.len() { x } else { y }
}
```

## Notes

- Generic type parameters and lifetime parameters share the same `<>` bracket.
- Lifetime annotations do **not** change how long references live; they describe relationships.
- Most lifetimes are inferred; annotations are needed only when relationships are ambiguous.
- Traits must be in scope to call their methods (e.g., `use rand::Rng`).

## Related

- [Chapter 4: Understanding Ownership](./04-ownership.md)
- [Chapter 9: Error Handling](./09-error-handling.md)
- [Chapter 18: OOP Features](./18-oop.md)
- [Chapter 20: Advanced Features](./20-advanced-features.md)
