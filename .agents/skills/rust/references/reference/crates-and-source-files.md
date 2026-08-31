# Crates and Source Files

A **crate** is the unit of compilation and linking in Rust. The compiler processes one source file as input and produces one crate artifact.

## Crate Structure

```
Crate → InnerAttribute* Item*
```

A source file describes a module whose name and location are defined externally. It contains zero or more item definitions and may begin with inner attributes that apply to the whole crate.

```rust
#![crate_name = "projx"]
#![crate_type = "lib"]
#![warn(non_camel_case_types)]

pub fn hello() {}
```

## The `main` Function

To produce an executable, a crate must contain a `main` function:

- Takes no arguments
- Has no trait or lifetime bounds
- Has no `where` clauses
- Return type must implement `Termination`

```rust
fn main() {}

fn main() -> impl std::process::Termination {
    std::process::ExitCode::SUCCESS
}

fn main() -> ! {
    std::process::exit(0);
}
```

`main` may also be imported from another module:

```rust
use foo::bar as main;
```

Types that implement `Termination`: `()`, `!`, `Infallible`, `ExitCode`, `Result<T: Termination, E: Debug>`.

## Crate Attributes

### `#![no_main]`

Disables emitting the `main` symbol. Use when another object defines `main` (e.g., embedding Rust in a C application).

### `#![crate_name = "name"]`

Specifies the crate name. Must be non-empty and contain only Unicode alphanumerics or `_`.

### `#![crate_type = "type"]`

Specifies the output artifact type. See [linkage.md](./linkage.md) for all crate types.

## Module Organization

- Modules can be **inline** (nested in the same file) or **file-based** (separate `.rs` files).
- Every item has a **canonical path** within the crate's module tree.
- Items may be defined in any order within a module (except `macro_rules!`, which is textually scoped).

## Shebang Support

Files may start with a shebang on the first line; it is stripped before parsing:

```sh
#!/usr/bin/env rustx
```

If `#!` is immediately followed (ignoring whitespace/comments) by `[`, it is treated as an inner attribute rather than a shebang.

## Uncaught Foreign Unwinding

If foreign unwinding (e.g., C++ exceptions) propagates past `main`, the process aborts safely. Drop calls are not guaranteed to execute.

## Notes

- Source files use `.rs` extension.
- `include!` applies source preprocessing (BOM removal, CRLF normalization, shebang removal); `include_str!` and `include_bytes!` do not.

## Related

- [items.md](./items.md)
- [linkage.md](./linkage.md)
- [attributes.md](./attributes.md)
