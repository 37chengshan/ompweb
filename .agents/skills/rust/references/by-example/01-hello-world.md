# Hello World

The entry point of a Rust program is `fn main()`. The `println!` macro (note the `!`) prints text to stdout. Comments begin with `//`.

## Signature / Usage

```rust
fn main() {
    // This is a comment, ignored by the compiler.
    println!("Hello World!");
}
```

## Compilation

```bash
$ rustc hello.rs
$ ./hello
Hello World!
```

## Notes

- `println!` is a **macro**, not a function — indicated by the trailing `!`.
- The `main` function is required as the entry point of every executable.
- Subsections cover: Comments (`//`, `/* */`, `///`, `//!`), Formatted print (`print!`, `println!`, `eprint!`, `format!`), and Debug/Display formatting.

## Related

- [02-primitives.md](./02-primitives.md)
