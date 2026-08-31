# Structs and Methods

Group related data in a struct and attach behavior with `impl` blocks.

```rust
#[derive(Debug)]
struct Rectangle {
    width: u32,
    height: u32,
}

impl Rectangle {
    // Associated function — used as a constructor (called with `::`)
    fn square(size: u32) -> Self {
        Self { width: size, height: size }
    }

    // Method — first parameter is &self (immutable borrow)
    fn area(&self) -> u32 {
        self.width * self.height
    }

    fn can_hold(&self, other: &Rectangle) -> bool {
        self.width > other.width && self.height > other.height
    }

    // Mutable method
    fn scale(&mut self, factor: u32) {
        self.width *= factor;
        self.height *= factor;
    }
}

fn main() {
    let rect1 = Rectangle { width: 30, height: 50 };
    let rect2 = Rectangle::square(25); // associated function

    println!("rect1: {rect1:?}");         // Debug print
    println!("area: {}", rect1.area());
    println!("can hold rect2: {}", rect1.can_hold(&rect2));

    // Struct update syntax — remaining fields from rect1
    let rect3 = Rectangle { width: 10, ..rect1 };
    println!("rect3: {rect3:#?}"); // pretty Debug

    // Mutable instance
    let mut rect4 = Rectangle { width: 5, height: 5 };
    rect4.scale(3);
    println!("scaled: {rect4:?}");
}
```

## Notes

- The whole struct instance must be declared `mut` to mutate any field.
- `#[derive(Debug)]` enables `{:?}` (compact) and `{:#?}` (pretty-printed) formatting.
- Rust auto-references/dereferences method calls, so `rect1.area()` and `(&rect1).area()` are equivalent.
- Multiple `impl` blocks are allowed; useful when implementing traits separately.
