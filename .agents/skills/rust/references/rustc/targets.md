# Targets

A "target" specifies the architecture, OS, ABI, and environment for which `rustc` generates code. `rustc` is a cross-compiler by default.

## Signature / Usage

```bash
# Compile for a specific target
rustc src/main.rs --target=wasm32-unknown-unknown

# List all built-in targets
rustc --print target-list

# Show target specification JSON (nightly)
rustc +nightly -Z unstable-options --print target-spec-json
rustc +nightly -Z unstable-options --target=wasm32-unknown-unknown --print target-spec-json
```

## Built-in Targets

Built-in targets are shipped with `rustc` and correspond to platforms the Rust team supports directly. Most require a compiled copy of the Rust standard library and a system linker.

When using `rustup`, install the standard library for a target with:

```bash
rustup target add <TARGET>
```

For cross-compilation setup, see the [rustup cross-compilation docs](https://rust-lang.github.io/rustup/cross-compilation.html).

## Target Features

Some architectures (x86, ARMv8, etc.) support optional CPU instruction set extensions. These are controlled with `-C target-feature`:

```bash
# Enable AVX2 instructions
rustc src/main.rs -C target-feature=+avx2

# Enable AVX, disable SSE4.1
rustc src/main.rs -C target-feature=+avx,-sse4.1

# Link C runtime statically
rustc src/main.rs -C target-feature=+crt-static
```

Discover available features for the current target:

```bash
rustc --print target-features
```

## Custom Targets

For platforms not yet supported, a JSON target specification can be used (nightly only):

```bash
# Generate schema for validation
rustc +nightly -Zunstable-options --print target-spec-json-schema

# Use a custom target JSON file
rustc +nightly --target=./my-target.json input.rs
```

Target lookup order for `--target=TARGET`:

1. Built-in target matching `TARGET` by name
2. File path if `TARGET` looks like a file path
3. `RUST_TARGET_PATH` directories searched left to right for `TARGET.json`

## Notes

- `--print target-list` shows all targets available in the current `rustc` version.
- `-C target-feature` is **unsafe**; enabling unsupported features causes undefined behavior at runtime.
- Custom target JSON properties are **unstable** and subject to change between compiler versions. Pin your compiler version when using custom targets.
- `target-spec-json` schema and its location are also not stability-guaranteed.

## Related

- [command-line-arguments.md](./command-line-arguments.md)
- [codegen-options.md](./codegen-options.md)
- [platform-support.md](./platform-support.md)
