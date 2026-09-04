# Chapter 18: Object-Oriented Programming Features

How Rust relates to OOP concepts, and how to use trait objects for dynamic polymorphism.

## OOP Characteristics in Rust

| OOP Concept | Rust Equivalent |
|-------------|----------------|
| Objects with data + behavior | Structs/enums + `impl` blocks |
| Encapsulation | `pub` / private by default |
| Inheritance | Not supported — use trait default methods or composition |
| Polymorphism | Generics (static) + trait objects (dynamic) |

### Encapsulation example

```rust
pub struct AveragedCollection {
    list: Vec<i32>,    // private
    average: f64,      // private
}

impl AveragedCollection {
    pub fn add(&mut self, value: i32) {
        self.list.push(value);
        self.update_average();
    }
    pub fn average(&self) -> f64 { self.average }
    fn update_average(&mut self) {
        self.average = self.list.iter().sum::<i32>() as f64 / self.list.len() as f64;
    }
}
```

## Trait Objects — Dynamic Dispatch

Use `Box<dyn Trait>` (or `&dyn Trait`) for heterogeneous collections where the concrete type is unknown at compile time.

```rust
pub trait Draw {
    fn draw(&self);
}

pub struct Screen {
    pub components: Vec<Box<dyn Draw>>, // can hold any type implementing Draw
}

impl Screen {
    pub fn run(&self) {
        for component in &self.components {
            component.draw(); // dynamic dispatch via vtable
        }
    }
}

// Any type can be added as long as it implements Draw
struct Button { width: u32, height: u32, label: String }
impl Draw for Button { fn draw(&self) { /* ... */ } }

let screen = Screen {
    components: vec![
        Box::new(Button { width: 50, height: 10, label: String::from("OK") }),
        Box::new(SelectBox { /* ... */ }),
    ],
};
screen.run();
```

### Static dispatch (generics) vs dynamic dispatch (trait objects)

```rust
// Generics: monomorphization, all components must be the same concrete type
pub struct Screen<T: Draw> {
    pub components: Vec<T>,
}

// Trait objects: runtime vtable lookup, components can be different types
pub struct Screen {
    pub components: Vec<Box<dyn Draw>>,
}
```

- Trait objects incur a small runtime cost (vtable lookup, no inlining).
- Use trait objects for open extensibility; generics for performance with a single type.

## State Pattern

### OOP style (trait objects)

```rust
pub struct Post { state: Option<Box<dyn State>>, content: String }
trait State {
    fn request_review(self: Box<Self>) -> Box<dyn State>;
    fn approve(self: Box<Self>) -> Box<dyn State>;
    fn content<'a>(&self, _: &'a Post) -> &'a str { "" }
}
```

### Rust-native style (type-state pattern)

Encode states as different types — invalid state transitions become compile errors:

```rust
pub struct DraftPost     { content: String }
pub struct PendingReview { content: String }
pub struct Post          { content: String }

impl DraftPost {
    pub fn new() -> DraftPost { DraftPost { content: String::new() } }
    pub fn add_text(&mut self, text: &str) { self.content.push_str(text); }
    pub fn request_review(self) -> PendingReview { PendingReview { content: self.content } }
}
impl PendingReview {
    pub fn approve(self) -> Post { Post { content: self.content } }
}
impl Post {
    pub fn content(&self) -> &str { &self.content }
}
```

- The compiler prevents calling `content()` on `DraftPost` or `PendingReview` (method doesn't exist).
- No runtime overhead — transitions are just function calls.

## Notes

- Rust does not support classical inheritance (no `extend` / base classes).
- Default trait method implementations provide code reuse similar to inheritance.
- The type-state pattern is idiomatic Rust — prefer it over the OOP state pattern when possible.
- Object safety rules: a trait can be used as a trait object only if its methods don't have generic type parameters and don't return `Self`.

## Related

- [Chapter 10: Generic Types, Traits, and Lifetimes](./10-generic-types-traits-lifetimes.md)
- [Chapter 15: Smart Pointers](./15-smart-pointers.md)
- [Chapter 20: Advanced Features](./20-advanced-features.md)
