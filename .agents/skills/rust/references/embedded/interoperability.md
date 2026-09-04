# Interoperability (FFI with C)

Embedded Rust projects often need to call existing C libraries (vendor SDKs, RTOSes) or expose Rust code to C applications. The C ABI is the lingua franca; C++ lacks a stable ABI for the Rust compiler.

## Type Mapping

| Rust Type | Intermediate | C Type |
|-----------|--------------|--------|
| `String` | `CString` | `char *` |
| `&str` | `CStr` | `const char *` |
| `()` | `c_void` | `void` |
| `u32` / `u64` | `c_uint` | `unsigned int` |
| `i32` | `c_int` | `int` |

Use `core::ffi` (Rust 1.30+) or the `cty` crate for `no_std` type aliases.

## Calling C from Rust

### Manual FFI Declarations

```c
/* cool.h */
typedef struct CoolStruct { int x; int y; } CoolStruct;
void cool_function(int i, char c, CoolStruct *cs);
```

```rust
use cty::{c_int, c_char};

#[repr(C)]
pub struct CoolStruct {
    pub x: c_int,
    pub y: c_int,
}

extern "C" {
    pub fn cool_function(i: c_int, c: c_char, cs: *mut CoolStruct);
}

// Usage
unsafe { cool_function(42, b'A' as c_char, &mut my_struct as *mut _); }
```

### Automatic Bindings with bindgen

```bash
bindgen --ctypes-prefix=cty --use-core bindings.h -o src/bindings.rs
```

Flags for `no_std` compatibility:
- `--ctypes-prefix=cty` → uses `cty` types instead of `std::os::raw`
- `--use-core` → uses `core` instead of `std`

### Building C Code from Cargo

```rust
// build.rs
fn main() {
    cc::Build::new()
        .file("src/vendor.c")
        .compile("vendor");  // produces libvendor.a, linked automatically
}
```

Or call external build systems:
```rust
// build.rs
std::process::Command::new("make")
    .arg("library")
    .output()
    .expect("make failed");
```

## Calling Rust from C

### Rust Side

```rust
// Cargo.toml: crate-type = ["staticlib"]

#[no_mangle]  // prevents name mangling
pub extern "C" fn rust_function(x: u32) -> u32 {
    x * 2
}
```

- `#[no_mangle]`: keeps the symbol name as-is for the linker
- `extern "C"`: uses the C ABI calling convention

### Generate C Headers with cbindgen

```bash
cbindgen --lang c --output include/my_lib.h
```

Produces:
```c
/* my_lib.h */
uint32_t rust_function(uint32_t x);
```

### C Side

```c
#include "my_lib.h"
uint32_t result = rust_function(21);
```

## `#[repr(C)]` is Required for Shared Structs

```rust
// Without repr(C): field order and padding are undefined
// With repr(C): matches C struct layout exactly
#[repr(C)]
pub struct Packet { pub id: u16, pub length: u8, pub data: u8 }
```

## Notes

- All FFI calls are `unsafe` in Rust; the programmer ensures C contracts are upheld
- `build.rs` runs on the *host* machine, not the target; use cross-compilation-aware flags when invoking compilers
- For RTOS integration (FreeRTOS, ChibiOS), pre-built binding crates often exist on crates.io
- Dynamic libraries (`cdylib`) are rarely used in embedded; prefer `staticlib` for firmware

## Related

- [tips-for-embedded-c-devs.md](./tips-for-embedded-c-devs.md)
- [no-std.md](./no-std.md)
