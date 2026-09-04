# Rust Standard Library Overview

The Rust Standard Library (`std`) is the foundation of portable Rust software — a set of minimal, battle-tested shared abstractions for the broader Rust ecosystem. It is available to all Rust crates by default.

Official docs: https://doc.rust-lang.org/std/

## Crate Hierarchy: core / alloc / std

The standard library is split into three layered crates:

| Crate | Description | Use case |
|-------|-------------|----------|
| `core` | The minimal foundation. No heap allocation, no OS dependencies. | `no_std` environments (embedded, kernels) |
| `alloc` | Adds heap allocation APIs on top of `core` (`Box`, `Vec`, `String`, etc.). | Environments with an allocator but no full OS |
| `std` | Full standard library. Builds on `core` and `alloc`, adds I/O, threading, networking, and platform abstractions. | Default for all Rust programs |

`std` re-exports everything from `core` and `alloc`, so code written against `std` does not need to import those separately. When writing `no_std` crates, explicitly depend on `core` (always available) or `core` + `alloc`.

## What `std` Provides

1. **Essential types** — `Vec`, `Option`, `Result`, `String`, `HashMap`
2. **Core traits** — `Iterator`, `From`/`Into`, `Clone`, `Default`, `Eq`/`Ord`, `Hash`
3. **I/O abstractions** — files, sockets, standard streams
4. **Multithreading** — threads, channels, synchronization primitives
5. **Platform abstraction** — unified API over Windows, macOS, Linux, etc.
6. **Standard macros** — printing, assertions, compile-time control

## Primitive Types

Primitives are built into the language; `std` documents their methods.

### Integer types

| Type | Description |
|------|-------------|
| `i8`, `i16`, `i32`, `i64`, `i128` | Signed integers (8–128 bit) |
| `u8`, `u16`, `u32`, `u64`, `u128` | Unsigned integers (8–128 bit) |
| `isize` | Pointer-sized signed integer |
| `usize` | Pointer-sized unsigned integer (used for indexing) |

### Floating-point types

| Type | Description |
|------|-------------|
| `f32` | 32-bit IEEE 754 floating-point (binary32) |
| `f64` | 64-bit IEEE 754 floating-point (binary64) |

### Other primitives

| Type | Description |
|------|-------------|
| `bool` | Boolean: `true` or `false` |
| `char` | Unicode scalar value (4 bytes) |
| `str` | UTF-8 string slice (unsized); usually seen as `&str` |
| `array` | Fixed-size array `[T; N]` |
| `slice` | Dynamically-sized view into a contiguous sequence `[T]` |
| `tuple` | Heterogeneous fixed-size sequence `(T, U, ..)` |
| `fn` | Function pointer |
| `pointer` | Raw pointers `*const T` / `*mut T` |
| `reference` | References `&T` / `&mut T` |
| `unit` | The `()` type; returned by expressions with no value |
| `never` | `!` — the type of diverging expressions (experimental) |

## Key Macros

### Output & formatting

| Macro | Description |
|-------|-------------|
| `println!` | Print a line to stdout |
| `print!` | Print to stdout without newline |
| `eprintln!` / `eprint!` | Print to stderr |
| `format!` | Format arguments into a `String` |
| `write!` / `writeln!` | Write formatted text to a buffer implementing `Write` |
| `dbg!` | Print the value and expression to stderr; returns the value |

### Assertions

| Macro | Description |
|-------|-------------|
| `assert!` | Panic if condition is false |
| `assert_eq!` / `assert_ne!` | Panic if two values are (not) equal |
| `debug_assert!` / `debug_assert_eq!` / `debug_assert_ne!` | Assertions active only in debug builds |

### Control flow markers

| Macro | Description |
|-------|-------------|
| `panic!` | Halt execution with a message |
| `todo!` | Placeholder for unimplemented code (panics at runtime) |
| `unimplemented!` | Similar to `todo!`, signals intentionally absent code |
| `unreachable!` | Assert a code path should never be reached |
| `matches!` | Return `true` if a value matches a pattern |

### Collections

| Macro | Description |
|-------|-------------|
| `vec!` | Create a `Vec` from a list of values: `vec![1, 2, 3]` |

### Compile-time & environment

| Macro | Description |
|-------|-------------|
| `cfg!` | Evaluate a `#[cfg]` condition at compile time |
| `env!` | Embed an environment variable's value at compile time |
| `option_env!` | Like `env!` but returns `Option<&str>` |
| `include_str!` | Embed a file as a `&str` at compile time |
| `include_bytes!` | Embed a file as a `&[u8]` at compile time |
| `file!` / `line!` / `column!` / `module_path!` | Source location metadata |
| `thread_local!` | Declare thread-local storage |
| `stringify!` | Convert tokens to a string literal |

## How to Navigate the Documentation

The standard library docs at https://doc.rust-lang.org/std/ are organized into three top-level sections:

- **Primitive Types** — methods on built-in types (`str`, `i32`, `slice`, …)
- **Modules** — `std::collections`, `std::io`, `std::sync`, …
- **Macros** — all standard macros

**Tips:**

- Use the **search bar** (press `S` or `/`) to find any item by name.
- Press **"Summary"** to collapse verbose prose into a skimmable outline.
- Each item page links to its **source code** — reading it is encouraged.
- Some primitives have a companion module (e.g., `char` primitive vs. `std::char` module): the primitive page lists methods; the module page documents associated iterator and error types.

## Related

- [module-categories.md](./module-categories.md)
