# Expressions

A Rust program is made up of statements and expressions. Expressions evaluate to a value; statements perform an action. Blocks `{}` are expressions — their value is the last expression inside (without a trailing `;`).

## Signature / Usage

```rust
fn main() {
    let x = 5;

    // Statement (binds a value, returns nothing)
    let y = {
        let x_squared = x * x;
        let x_cube    = x_squared * x;

        // Last expression — no semicolon — becomes the value of the block
        x_cube + x_squared + x
    };
    println!("y = {}", y); // y = 155

    // Adding `;` suppresses the return value — block returns `()`
    let z = {
        2 * x;   // semicolon → statement, block returns ()
    };
    // z is ()
}
```

## Notes

- Omitting the semicolon on the final line of a block makes it an **expression** that returns a value.
- Adding a semicolon converts the final expression to a **statement**, making the block return `()`.
- `if`/`else`, `match`, and `loop` are also expressions and can be used on the right-hand side of `let`.

## Related

- [08-flow-of-control.md](./08-flow-of-control.md)
- [09-functions.md](./09-functions.md)
