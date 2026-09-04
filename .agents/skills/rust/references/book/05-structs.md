# Chapter 5: Using Structs

Custom data types that group related named fields, with methods to attach behavior.

## Defining and Instantiating

```rust
struct User {
    active: bool,
    username: String,
    email: String,
    sign_in_count: u64,
}

// Instantiate
let user1 = User {
    active: true,
    username: String::from("alice"),
    email: String::from("alice@example.com"),
    sign_in_count: 1,
};

// Mutable instance — the whole instance must be mut
let mut user1 = User { /* ... */ };
user1.email = String::from("new@example.com");
```

### Field init shorthand

```rust
fn build_user(email: String, username: String) -> User {
    User {
        active: true,
        username,   // shorthand when param name == field name
        email,
        sign_in_count: 1,
    }
}
```

### Struct update syntax

```rust
let user2 = User {
    email: String::from("other@example.com"),
    ..user1  // remaining fields from user1 (moves String fields)
};
```

### Tuple structs and unit-like structs

```rust
struct Color(i32, i32, i32);
struct Point(i32, i32, i32);

let black = Color(0, 0, 0);
let x = black.0; // index access

struct AlwaysEqual; // no fields; useful for implementing traits
let subject = AlwaysEqual;
```

## Methods

```rust
#[derive(Debug)]
struct Rectangle {
    width: u32,
    height: u32,
}

impl Rectangle {
    // Method: first param is &self (borrows immutably)
    fn area(&self) -> u32 {
        self.width * self.height
    }

    fn can_hold(&self, other: &Rectangle) -> bool {
        self.width > other.width && self.height > other.height
    }

    // Associated function (no self) — often used as constructor
    fn square(size: u32) -> Self {
        Self { width: size, height: size }
    }
}

let rect = Rectangle { width: 30, height: 50 };
println!("Area: {}", rect.area());
let sq = Rectangle::square(10); // call with :: syntax
```

### `self` parameter forms

| Form | Meaning |
|------|---------|
| `&self` | Immutable borrow (read-only) |
| `&mut self` | Mutable borrow (can modify) |
| `self` | Takes ownership (rare; transforms the instance) |

## Notes

- Rust applies automatic referencing/dereferencing when calling methods, so `rect.area()` and `(&rect).area()` are equivalent.
- Use owned types (`String`) rather than references (`&str`) in struct fields to avoid lifetime annotations (until Chapter 10).
- A struct can have multiple `impl` blocks (useful with generics and traits).
- `#[derive(Debug)]` auto-generates `{:?}` / `{:#?}` printing.

## Related

- [Chapter 4: Understanding Ownership](./04-ownership.md)
- [Chapter 6: Enums and Pattern Matching](./06-enums-and-pattern-matching.md)
- [Chapter 10: Generic Types, Traits, and Lifetimes](./10-generic-types-traits-lifetimes.md)
