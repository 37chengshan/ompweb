# Chapter 20: Advanced Features

Unsafe Rust, advanced traits, advanced types, function pointers, and macros.

## Unsafe Rust

`unsafe` blocks grant five additional capabilities not checked by the borrow checker:

```rust
unsafe {
    // 1. Dereference raw pointers
    let r1 = &raw const num;  // *const i32
    let r2 = &raw mut num;    // *mut i32
    println!("{}", *r1);

    // 2. Call unsafe functions
    dangerous();

    // 3. Access/modify mutable static variables
    static mut COUNTER: u32 = 0;
    COUNTER += 1;
}

// 4. Implement unsafe traits
unsafe trait Foo {}
unsafe impl Foo for i32 {}

// 5. Access fields of unions
union MyUnion { f1: u32, f2: f32 }
unsafe { let u = MyUnion { f1: 1 }; println!("{}", u.f1); }
```

### Creating safe abstractions over unsafe code

```rust
use std::slice;

fn split_at_mut(values: &mut [i32], mid: usize) -> (&mut [i32], &mut [i32]) {
    let len = values.len();
    let ptr = values.as_mut_ptr();
    assert!(mid <= len);
    unsafe {
        (
            slice::from_raw_parts_mut(ptr, mid),
            slice::from_raw_parts_mut(ptr.add(mid), len - mid),
        )
    }
}
```

### FFI (Foreign Function Interface)

```rust
unsafe extern "C" {
    fn abs(input: i32) -> i32;   // call C function
}

#[unsafe(no_mangle)]
pub extern "C" fn call_from_c() { } // export to C
```

Best practices: keep `unsafe` blocks small; document with `// SAFETY:` comments; use `cargo +nightly miri run` to detect undefined behavior.

## Advanced Traits

### Associated types

```rust
pub trait Iterator {
    type Item;  // associated type — one per implementor, unlike generics
    fn next(&mut self) -> Option<Self::Item>;
}

impl Iterator for Counter {
    type Item = u32;
    fn next(&mut self) -> Option<u32> { /* ... */ }
}
```

### Default generic parameters

```rust
trait Add<Rhs = Self> {   // default: add same type
    type Output;
    fn add(self, rhs: Rhs) -> Self::Output;
}

// Override default: add Meters to Millimeters
impl Add<Meters> for Millimeters {
    type Output = Millimeters;
    fn add(self, other: Meters) -> Millimeters { /* ... */ }
}
```

### Disambiguation and fully qualified syntax

```rust
Pilot::fly(&person);            // call specific trait's method
<Dog as Animal>::baby_name();   // fully qualified: no self parameter
```

### Supertraits

```rust
trait OutlinePrint: fmt::Display { // requires Display to also be implemented
    fn outline_print(&self) { let s = self.to_string(); /* ... */ }
}
```

### Newtype pattern (bypass orphan rule)

```rust
struct Wrapper(Vec<String>);
impl fmt::Display for Wrapper {  // can now impl Display for Vec
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "[{}]", self.0.join(", "))
    }
}
```

## Advanced Types

```rust
// Type alias: synonym, no extra type safety
type Kilometers = i32;
type Thunk = Box<dyn Fn() + Send + 'static>; // useful for long types

// Never type (!): functions that never return
fn bar() -> ! { panic!(""); }

// Dynamically sized types: always behind a pointer
let s: &str = "hello";         // str is DST, &str is fat pointer
let b: Box<dyn Trait> = ...;   // dyn Trait is DST

// ?Sized: allow DSTs as generic parameter
fn generic<T: ?Sized>(t: &T) { }
```

## Advanced Functions and Closures

```rust
// Function pointers: fn is a type, not a trait
fn add_one(x: i32) -> i32 { x + 1 }
fn do_twice(f: fn(i32) -> i32, arg: i32) -> i32 { f(arg) + f(arg) }
let answer = do_twice(add_one, 5); // 12

// fn implements Fn, FnMut, FnOnce — can pass named functions where closures expected
let strings: Vec<String> = nums.iter().map(ToString::to_string).collect();

// Returning closures
fn returns_closure() -> impl Fn(i32) -> i32 { |x| x + 1 }
fn returns_dynamic() -> Box<dyn Fn(i32) -> i32> { Box::new(|x| x + 1) }
```

## Macros

### Declarative macros (macro_rules!)

```rust
#[macro_export]
macro_rules! vec {
    ( $( $x:expr ),* ) => {
        {
            let mut temp = Vec::new();
            $( temp.push($x); )*
            temp
        }
    };
}
```

### Procedural macros

```rust
// Custom derive
#[proc_macro_derive(HelloMacro)]
pub fn hello_macro_derive(input: TokenStream) -> TokenStream {
    let ast: syn::DeriveInput = syn::parse(input).unwrap();
    let name = &ast.ident;
    quote! {
        impl HelloMacro for #name {
            fn hello_macro() { println!("Hello from {}!", stringify!(#name)); }
        }
    }.into()
}

// Attribute-like macro
#[proc_macro_attribute]
pub fn route(attr: TokenStream, item: TokenStream) -> TokenStream { /* ... */ }

// Function-like macro
#[proc_macro]
pub fn sql(input: TokenStream) -> TokenStream { /* ... */ }
```

| Macro type | Syntax | Use case |
|------------|--------|----------|
| `macro_rules!` | `vec![...]` | Variable args, general metaprogramming |
| Derive | `#[derive(Trait)]` | Auto-implement traits |
| Attribute | `#[route(GET, "/")]` | Custom attributes on any item |
| Function-like | `sql!(SELECT ...)` | Complex code generation |

Macros vs. functions: macros can accept variable argument counts, generate code, implement traits, and expand before type-checking; functions cannot.

## Notes

- `unsafe` doesn't disable the borrow checker; it only unlocks the five superpowers listed above.
- Associated types vs. generics: associated types allow only one implementation per type; generics allow multiple.
- Procedural macros live in separate crates with `proc-macro = true` in `Cargo.toml`.
- The `syn` and `quote` crates are the standard tools for procedural macro development.

## Related

- [Chapter 10: Generic Types, Traits, and Lifetimes](./10-generic-types-traits-lifetimes.md)
- [Chapter 18: OOP Features](./18-oop.md)
- [Chapter 21: Final Project](./21-final-project.md)
