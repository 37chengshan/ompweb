# Modules

Modules (`mod`) organize code into logical units and control visibility. Items are private by default; `pub` makes them public.

## Signature / Usage

```rust
mod my_mod {
    // Private by default
    fn private_fn() {}

    pub fn public_fn() {
        println!("public");
    }

    pub mod nested {
        pub fn nested_fn() {
            // Access parent-scope private item via super
            super::private_fn();
        }
    }
}

fn main() {
    my_mod::public_fn();
    my_mod::nested::nested_fn();
    // my_mod::private_fn(); // error: private
}
```

## Visibility Modifiers

| Modifier | Scope |
|----------|-------|
| (none) | Private to the current module |
| `pub` | Accessible everywhere |
| `pub(crate)` | Accessible within the current crate |
| `pub(super)` | Accessible to the parent module |
| `pub(in path)` | Accessible within a specific module path |

## use Declaration

```rust
use my_mod::nested::nested_fn;

fn main() {
    nested_fn(); // no full path needed
}

// Alias with `as`
use std::fmt::Result as FmtResult;
```

## File Hierarchy

Split modules across files:

```
src/
  main.rs       // mod my_module;  ← declares module
  my_module.rs  // contents of my_module
```

Or using a directory:

```
src/
  main.rs
  my_module/
    mod.rs      // contents of my_module
    sub.rs      // mod sub; declared in mod.rs
```

## Notes

- `self` refers to the current module; `super` refers to the parent module.
- `use` can glob-import with `use my_mod::*;` (use sparingly).
- Struct fields follow their own visibility rules independently of the struct itself.

## Related

- [11-crates.md](./11-crates.md)
- [12-cargo.md](./12-cargo.md)
