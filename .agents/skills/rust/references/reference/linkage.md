# Linkage

Controls how Rust crates are compiled and linked. The `--crate-type` compiler flag or `#![crate_type = "..."]` attribute specifies the output format.

## Crate Types

| Type | Description | Output |
|------|-------------|--------|
| `bin` | Executable binary (requires `main`) | platform executable |
| `lib` | Compiler-preferred library format (alias) | rlib by default |
| `rlib` | Rust library (intermediate, includes metadata) | `.rlib` |
| `dylib` | Rust dynamic library | `.so`, `.dylib`, `.dll` |
| `staticlib` | Static system library (includes all deps) | `.a`, `.lib` |
| `cdylib` | C-compatible dynamic library for FFI | `.so`, `.dylib`, `.dll` |
| `proc-macro` | Procedural macro crate | host-compiled artifact |

```rust
// In source:
#![crate_type = "cdylib"]

// Or on command line:
// rustc --crate-type=cdylib lib.rs
```

Multiple types can be specified simultaneously (no recompilation):
```sh
rustc --crate-type=rlib --crate-type=dylib lib.rs
```

### Key Distinctions

- **`staticlib`**: Bundles all upstream dependencies into one archive. Recommended for embedding Rust in non-Rust projects. Use `--print=native-static-libs` to discover required native library flags.
- **`cdylib`**: Exposes a C ABI. Does **not** embed Rust's dynamic stdlib in the same way as `dylib`.
- **`rlib`**: Does **not** contain upstream dependencies — they are resolved at final link time.
- **`proc-macro`**: Always compiled for the **host** (not the cross-compile target).

## Dependency Resolution Rules

| Building... | Upstream format |
|-------------|----------------|
| `staticlib` | All deps must be `rlib` (no dynamic allowed) |
| `rlib` | Any format (only metadata required) |
| Executable without `-C prefer-dynamic` | Prefer `rlib`, fall back to `dylib` |
| Executable/`dylib` with dynamic linking | Maximize `dylib` usage, reconcile conflicts |

A library may not appear more than once in an artifact. If dynamic linking, prefer having all libraries as `dylib`.

## Native Library Linking

### Via `rustc` flags

```sh
rustc -L /path/to/libs -lmylib main.rs
rustc -Clink-arg=file.o main.rs
```

### Via `#[link]` attribute

```rust
#[link(name = "mylib")]
extern "C" {
    fn my_function();
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {}
```

`kind` values: `dylib` (default), `static`, `framework` (macOS), `raw-dylib` (Windows), `link-arg`.

## C Runtime Linking

Most targets link dynamically to the C runtime by default. Targets using `musl` libc (`*-musl`) link statically by default.

```sh
# Static CRT
rustc -C target-feature=+crt-static foo.rs

# Dynamic CRT
rustc -C target-feature=-crt-static foo.rs
```

Detect at compile time:

```rust
#[cfg(target_feature = "crt-static")]
fn static_crt() { println!("static"); }

#[cfg(not(target_feature = "crt-static"))]
fn dynamic_crt() { println!("dynamic"); }
```

## Unwinding and Panic Safety

An artifact is **potentially unwinding** if it uses the `unwind` panic strategy and makes `-unwind` ABI calls.

- All crates in a potentially-unwinding artifact must use `unwind` panic strategy.
- Use the `ffi_unwind_calls` lint to identify `-unwind` foreign function calls.

## Related

- [abi.md](./abi.md)
- [crates-and-source-files.md](./crates-and-source-files.md)
- [items.md](./items.md)
