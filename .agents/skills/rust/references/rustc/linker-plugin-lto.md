# Linker-Plugin Based LTO

The `-C linker-plugin-lto` flag defers Link-Time Optimization (LTO) to the linker stage. This enables cross-language interprocedural optimization when all object files are produced by LLVM-based toolchains using the same LTO mode.

## Signature / Usage

```bash
# Compile Rust staticlib with linker-plugin LTO
rustc --crate-type=staticlib -C linker-plugin-lto -C opt-level=2 ./lib.rs

# Compile C code with thin LTO
clang -c -O2 -flto=thin -o cmain.o ./cmain.c

# Link with LLD
clang -flto=thin -fuse-ld=lld -L . -l"rust-lib-name" -o main -O2 ./cmain.o
```

## LTO Mode Flags by Compiler

| Compiler | Thin LTO | Fat LTO |
|----------|----------|---------|
| rustc | `-C lto=thin` | `-C lto=fat` |
| clang / clang++ | `-flto=thin` | `-flto=full` |
| flang | `-flto=thin` (WIP) | `-flto=full` |

Default mode for `-C linker-plugin-lto` is **thin LTO**.

## Use Cases

### Rust `staticlib` as C/C++ Dependency (Cargo)

```bash
RUSTFLAGS="-C linker-plugin-lto" cargo build --release
clang -c -O2 -flto=thin -o cmain.o ./cmain.c
clang -flto=thin -fuse-ld=lld -L . -l"rust-lib-name" -o main -O2 ./cmain.o
```

### C/C++ Code as Rust Dependency (Cargo)

```bash
clang ./clib.c -flto=thin -c -o ./clib.o -O2
ar crus ./libxyz.a ./clib.o
RUSTFLAGS="-C linker-plugin-lto -C linker=clang -C link-arg=-fuse-ld=lld" cargo build --release
```

### Fortran Code as Rust Dependency

```bash
# Fortran must use fat LTO (thin LTO is WIP in flang)
flang ./ftnlib.f90 -flto=full -c -o ./ftnlib.f90.o -O3
ar crus ./libftn.a ./ftnlib.f90.o

RUSTFLAGS="-C linker-plugin-lto -C lto=fat \
  -C link-arg=path/to/libftn.a -C linker=flang \
  -C default-linker-libraries=yes -C link-arg=-fuse-ld=lld" \
  cargo build --release
```

## Toolchain Compatibility

All compilers in the build must use the **same LLVM version**.

| Rust version | Compatible Clang version |
|--------------|--------------------------|
| 1.82 – 1.86 | 19 |
| 1.87 – 1.90 | 20 |
| 1.91 – 1.93 | 21 |

Check versions:

```bash
rustc -V --verbose
clang --version
```

## Windows (x86_64-pc-windows-msvc) Requirements

Use `clang-cl` and `lld-link` instead of MSVC tools:

```bat
set CC=clang-cl
set CXX=clang-cl
set CFLAGS=/clang:-flto=thin /clang:-fuse-ld=lld-link
set CXXFLAGS=/clang:-flto=thin /clang:-fuse-ld=lld-link
set AR=llvm-lib
```

For proc-macros, explicitly specify the target:

```bash
cargo build --target x86_64-pc-windows-msvc
```

## Notes

- The default LTO mode is thin LTO. Add `-C lto=fat` to use fat LTO.
- A custom linker plugin path can be specified: `-C linker-plugin-lto=/path/to/LLVMgold.so`.
- LLVM version mismatch between `rustc` and `clang` causes link failures.

## Related

- [codegen-options.md](./codegen-options.md)
- [profile-guided-optimization.md](./profile-guided-optimization.md)
