# Chapter 7: Managing Growing Projects with Packages, Crates, and Modules

Rust's module system for organizing code into packages, crates, and modules with controlled visibility.

## Packages and Crates

| Concept | Description |
|---------|-------------|
| **Crate** | Smallest compilation unit; either a binary or library |
| **Package** | Bundle of crates managed by `Cargo.toml` |
| **Crate root** | Source file where the compiler starts |

Cargo conventions:
- `src/main.rs` → binary crate root (same name as package)
- `src/lib.rs` → library crate root (same name as package)
- `src/bin/*.rs` → additional binary crates

A package may have **at most one library crate** but any number of binary crates.

## Modules

```rust
// src/lib.rs
mod front_of_house {
    pub mod hosting {
        pub fn add_to_waitlist() {}
    }
    mod serving {            // private by default
        fn take_order() {}
    }
}

pub fn eat_at_restaurant() {
    // Absolute path
    crate::front_of_house::hosting::add_to_waitlist();
    // Relative path
    front_of_house::hosting::add_to_waitlist();
}
```

- Items (functions, structs, modules) are **private by default**.
- `pub` makes them accessible from parent modules and external code.
- `pub struct` makes the struct public but fields remain private by default; add `pub` per field.
- `pub enum` makes all variants public.

## Paths and use

```rust
// Bring into scope
use crate::front_of_house::hosting;
hosting::add_to_waitlist();  // idiomatic for functions

use std::collections::HashMap;
let mut map = HashMap::new(); // idiomatic for types

// Rename with as
use std::io::Result as IoResult;

// Re-export with pub use
pub use crate::front_of_house::hosting;

// Nested paths
use std::{cmp::Ordering, io};
use std::io::{self, Write};

// Glob (use sparingly)
use std::collections::*;
```

## Splitting Modules Across Files

```
src/
├── lib.rs          → mod front_of_house;
├── front_of_house.rs   OR
└── front_of_house/
    ├── mod.rs
    └── hosting.rs
```

```rust
// src/lib.rs
mod front_of_house;  // loads src/front_of_house.rs or src/front_of_house/mod.rs
pub use crate::front_of_house::hosting;
```

## Notes

- `super::` navigates to the parent module (like `..` in filesystem paths).
- `self::` refers to the current module.
- The module tree mirrors a filesystem; modules can be inline or in separate files.
- Glob imports (`use x::*`) reduce clarity and may cause conflicts — prefer explicit imports.
- For very large projects, use Cargo workspaces (Chapter 14).

## Related

- [Chapter 6: Enums and Pattern Matching](./06-enums-and-pattern-matching.md)
- [Chapter 8: Common Collections](./08-common-collections.md)
- [Chapter 14: More about Cargo and Crates.io](./14-cargo-crates-io.md)
