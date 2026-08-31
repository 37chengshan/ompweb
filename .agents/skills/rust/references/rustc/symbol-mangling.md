# Symbol Mangling

`rustc` encodes unique symbol names during code generation using name mangling. The mangling scheme can be controlled via codegen options and per-item attributes.

## Signature / Usage

```bash
# Select mangling version globally
rustc -C symbol-mangling-version=v0 src/main.rs
```

## Options / Props

### `-C symbol-mangling-version`

| Value | Description |
|-------|-------------|
| `legacy` | Original scheme (currently the default) |
| `v0` | New scheme (RFC 2603): addresses ambiguities, supports Unicode identifiers |

### Per-item Attributes

| Attribute | Description |
|-----------|-------------|
| `#[no_mangle]` | Disable mangling; exports the symbol with its exact Rust name |
| `#[export_name = "name"]` | Export with a specific symbol name |
| `#[link_name = "name"]` | Change the symbol name used in `extern` blocks |

In Rust 2024, `#[no_mangle]` and `#[export_name]` must be written as `#[unsafe(no_mangle)]` and `#[unsafe(export_name = "...")]`.

## Decoding Mangled Names

| Tool | Description |
|------|-------------|
| `gdb` / `lldb` | Built-in Rust demangling support in modern versions |
| `rustc-demangle` crate | Programmatic demangling |
| `rustfilt` CLI | Command-line demangler |

```bash
$ cargo install rustfilt
$ rustfilt _RNvCskwGfYPst2Cb_3foo16example_function
foo::example_function
```

## v0 Mangling Scheme

The v0 scheme (RFC 2603) improves on the legacy format:

- Unambiguous encoding of all Rust symbol types
- Supports non-ASCII (Unicode) identifiers
- Enables better tooling support for debuggers

```bash
# Enable v0 globally (required for some coverage and sanitizer tooling)
RUSTFLAGS="-C symbol-mangling-version=v0" cargo build
```

## Notes

- `-C instrument-coverage` automatically selects `-C symbol-mangling-version=v0`.
- The v0 scheme is required for cross-language LTO with some linker plugins.
- `#[no_mangle]` creates a globally visible symbol — ensure uniqueness to avoid linker conflicts.

## Related

- [Codegen Options](./codegen-options.md)
- [Instrumentation-based Code Coverage](./instrument-coverage.md)
- [Exploit Mitigations](./exploit-mitigations.md)
