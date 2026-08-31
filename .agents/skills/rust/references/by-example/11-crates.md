# Crates

A crate is the fundamental compilation unit in Rust. Running `rustc file.rs` treats that file as the crate root. Crates produce either a **binary** (executable) or a **library**.

## Creating a Library

```rust
// rary.rs — a library crate
pub fn public_function() {
    println!("called rary's public_function()");
}

fn private_function() {
    println!("called rary's private_function()");
}

pub fn indirect_access() {
    private_function();
}
```

Compile to a library:

```bash
$ rustc --crate-type=lib rary.rs
# produces library.rlib
```

## Using a Library

```rust
// executable.rs
fn main() {
    rary::public_function();
    rary::indirect_access();
}
```

Link against the library:

```bash
$ rustc executable.rs --extern rary=library.rlib
```

## Notes

- Only crates are compiled as complete units; `mod` files within a crate are inlined before compilation.
- Library crates export a public API; private items are inaccessible from outside the crate.
- In practice, use **Cargo** to manage crates and their dependencies rather than calling `rustc` directly.
- Crate type options for `--crate-type`: `bin`, `lib`, `rlib`, `dylib`, `cdylib`, `staticlib`, `proc-macro`.

## Related

- [10-modules.md](./10-modules.md)
- [12-cargo.md](./12-cargo.md)
