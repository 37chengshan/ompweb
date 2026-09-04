# Items

An **item** is a compile-time component of a crate. Items are organized in a module hierarchy; every crate has one anonymous outermost module. Items are generally fixed during execution and may reside in read-only memory.

## Item Types

| Item | Purpose |
|------|---------|
| Modules (`mod`) | Organize code into hierarchical namespaces |
| `extern crate` declarations | Import external crates |
| `use` declarations | Bring paths into scope |
| Functions (`fn`) | Define callable functions |
| Type aliases (`type`) | Create aliases for types |
| Structs (`struct`) | Named product types |
| Enumerations (`enum`) | Sum types with variants |
| Unions (`union`) | C-like overlapping-field types |
| Constant items (`const`) | Compile-time constants |
| Static items (`static`) | Static-lifetime global storage |
| Trait definitions (`trait`) | Abstract interfaces |
| Implementations (`impl`) | Implement traits or methods on types |
| `extern` blocks | Declare FFI items |

## Functions

```rust
fn answer() -> i32 { 42 }

const fn square(x: i32) -> i32 { x * x }

async fn fetch() -> String { String::new() }

unsafe fn dangerous() {}

extern "C" fn c_callback() {}
```

Qualifiers: `const`, `async`, `unsafe`, `extern "ABI"` (can be combined as `async unsafe`).

Function parameters are irrefutable patterns:

```rust
fn first((value, _): (i32, i32)) -> i32 { value }
```

The first parameter can be a `self` parameter to make the function a method.

## Structs

```rust
struct Point { x: f64, y: f64 }         // named fields
struct Pair(i32, i32);                   // tuple struct
struct Unit;                             // unit struct
```

## Enumerations

```rust
enum Direction { North, South, East, West }

enum Message {
    Quit,
    Move { x: i32, y: i32 },
    Write(String),
}
```

## Unions

```rust
union FloatOrInt { f: f32, i: i32 }
```

Accessing union fields is `unsafe`. Unions have no drop glue for fields.

## Constants

```rust
const MAX: u32 = 100_000;
const BITS: usize = std::mem::size_of::<usize>() * 8;
```

Constants have no fixed address and may be inlined. They cannot have mutable interior.

## Static Items

```rust
static GREETING: &str = "Hello";
static mut COUNTER: u32 = 0;  // requires unsafe to access
```

Statics have a fixed address that lives for the entire program. `static mut` requires `unsafe` to read or write.

## Type Aliases

```rust
type Kilometers = i32;
type Result<T> = std::result::Result<T, String>;
```

## Traits

```rust
trait Animal {
    fn name(&self) -> &str;
    fn sound(&self) -> &str { "..." }  // default impl
}

trait Circle: Shape {  // supertrait
    fn radius(&self) -> f64;
}

unsafe trait Send {}   // unsafe trait
```

Associated items in traits:

```rust
trait Container {
    type Item;
    const MAX_SIZE: usize;
    fn push(&mut self, item: Self::Item);
}
```

A trait is **dyn-compatible** (object-safe) if all methods are dispatchable (no type parameters, take `self` by reference/pointer, no opaque return types) or explicitly non-dispatchable (`where Self: Sized`).

## Implementations

```rust
struct Circle { radius: f64 }

impl Circle {
    fn area(&self) -> f64 { std::f64::consts::PI * self.radius * self.radius }
}

impl Shape for Circle {
    fn name(&self) -> &str { "circle" }
}
```

## Modules

```rust
mod network {
    pub mod server {
        pub fn start() {}
    }
}

// File-based module (loads from network/client.rs or network/client/mod.rs)
mod network;
```

Items in a module can be referenced before or after their definition (except `macro_rules!`).

## `use` Declarations

```rust
use std::collections::HashMap;
use std::io::{self, Write};
use std::fmt::*;  // glob import
```

## `extern crate` Declarations

```rust
extern crate serde;
#[macro_use] extern crate log;
```

In the 2018+ editions, `extern crate` is rarely needed; crate names in `Cargo.toml` are automatically available.

## `extern` Blocks (FFI)

```rust
unsafe extern "C" {
    fn printf(format: *const i8, ...) -> i32;
    static errno: i32;
}
```

From the 2024 edition, `extern` blocks must be marked `unsafe`. Individual items may be marked `safe` to opt back in:

```rust
unsafe extern "C" {
    safe fn strlen(s: *const i8) -> usize;
}
```

## Visibility

```rust
pub fn public_fn() {}
pub(crate) fn crate_fn() {}
pub(super) fn parent_fn() {}
pub(in crate::module) fn restricted_fn() {}
fn private_fn() {}  // default: private
```

## Notes

- Items may be declared in any order within modules and blocks (except `macro_rules!`).
- Items declared inside a function block have restricted scopes — they cannot capture the enclosing function's generic parameters or local variables.
- Associated items (in `impl` and `trait`) are not directly scoped; they must be accessed via paths.

## Related

- [attributes.md](./attributes.md)
- [macros.md](./macros.md)
- [type-system.md](./type-system.md)
- [names.md](./names.md)
