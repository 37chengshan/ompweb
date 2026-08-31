# Variable Bindings

Values are bound to names with `let`. Rust is statically typed and infers types from context. Variables are immutable by default; add `mut` to allow mutation.

## Signature / Usage

```rust
fn main() {
    // Immutable binding with type inference
    let an_integer = 1u32;
    let a_boolean = true;
    let unit = ();

    // Suppress unused-variable warning with underscore prefix
    let _unused = 42;

    // Mutable binding
    let mut mutable = 12;
    mutable = 21;

    // Scope: inner binding shadows outer
    let shadowed = 1;
    {
        let shadowed = 2; // shadows outer `shadowed`
        println!("inner: {}", shadowed); // 2
    }
    println!("outer: {}", shadowed); // 1

    // Shadowing in same scope (rebind with new type)
    let shadowed = "now a string";

    // Declare first, initialize later
    let declared;
    declared = 5i32;
    println!("{}", declared);

    // Freezing: shadowing mut with immutable binding freezes it
    let mut frozen = 7i32;
    {
        let frozen = frozen; // immutable copy — `frozen` is now frozen
        // frozen = 50; // error: cannot assign to immutable variable
    }
    frozen = 3; // OK back in outer scope
}
```

## Notes

- A variable declared but never initialized cannot be used (compile error).
- Shadowing allows changing the type of a binding without `mut`.
- "Freezing" occurs when a mutable variable is re-bound immutably in an inner scope.

## Related

- [02-primitives.md](./02-primitives.md)
- [15-scoping-rules.md](./15-scoping-rules.md)
