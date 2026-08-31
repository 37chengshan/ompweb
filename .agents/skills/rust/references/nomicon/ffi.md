# Foreign Function Interface (FFI)

FFI enables calling C libraries from Rust and exposing Rust functions to C callers. All foreign function calls are `unsafe` because the compiler cannot verify correctness across language boundaries.

## Signature / Usage

```rust
// Calling C from Rust
use libc::size_t;

#[link(name = "snappy")]
unsafe extern "C" {
    fn snappy_max_compressed_length(source_length: size_t) -> size_t;
}

fn max_compressed_len(len: usize) -> usize {
    unsafe { snappy_max_compressed_length(len as size_t) as usize }
}

// Exposing Rust to C
#[unsafe(no_mangle)]
pub extern "C" fn hello_from_rust() {
    println!("Hello from Rust!");
}

// Cargo.toml for a C-callable library
// [lib]
// crate-type = ["cdylib"]
```

## Key Patterns

### Safe wrappers

Always wrap raw `extern "C"` declarations in a safe Rust function that validates inputs:

```rust
pub fn validate(src: &[u8]) -> bool {
    unsafe { snappy_validate_compressed_buffer(src.as_ptr(), src.len() as size_t) == 0 }
}
```

### Callbacks

```rust
extern "C" fn my_callback(value: i32) { println!("{value}"); }

unsafe extern {
    fn register_callback(cb: extern "C" fn(i32)) -> i32;
}
unsafe { register_callback(my_callback); }
```

For callbacks targeting Rust objects, pass a raw pointer to the object:

```rust
unsafe extern "C" fn callback(target: *mut MyStruct, a: i32) {
    unsafe { (*target).field = a; }
}
```

### `repr(C)` for structs crossing the boundary

```rust
#[repr(C)]
struct Point { x: f64, y: f64 }
```

### Nullable pointer optimization

```rust
type MaybeCallback = Option<extern "C" fn(i32) -> i32>;
// Same ABI as: int (*)(int) or NULL in C
```

### Accessing C global variables

```rust
unsafe extern {
    static rl_readline_version: libc::c_int;
    static mut rl_prompt: *const libc::c_char;
}
```

## Linking

```rust
#[link(name = "foo")]                           // dynamic
#[link(name = "foo", kind = "static")]          // static
#[link(name = "CoreFoundation", kind = "framework")]  // macOS framework
```

Or from `build.rs`:
```rust
println!("cargo:rustc-link-lib=dylib=stdc++");
```

## Calling Conventions

| ABI string | Used for |
|------------|---------|
| `"C"` | Standard C calling convention (platform default) |
| `"system"` | OS-appropriate (C on Unix, stdcall on 32-bit Windows) |
| `"stdcall"` | 32-bit Windows |
| `"C-unwind"` | C convention; panics/exceptions may cross the boundary |

## Unwinding Across FFI

```rust
// Without -unwind suffix: panic aborts the process at the boundary
extern "C" fn safe_cb() { panic!("stops here"); }

// With -unwind suffix: panic propagates as an exception into C++
extern "C-unwind" fn propagating_cb() { panic!("propagates"); }

// Catch at boundary explicitly (safest)
extern "C" fn catching_cb() -> i32 {
    match std::panic::catch_unwind(|| may_panic()) {
        Ok(v) => v,
        Err(_) => -1,
    }
}
```

## Notes

- **All `extern` function calls are `unsafe`**: the programmer is responsible for correct type declarations, calling conventions, and pointer validity.
- **`#[unsafe(no_mangle)]`**: prevents name mangling so C can find the symbol by its Rust name.
- **Type mismatches are UB**: Rust has no runtime check for C type signatures. Use `libc` crate types (`c_int`, `c_char`, `size_t`, etc.) for portability.
- **String handling**: C strings are null-terminated; Rust `str` is not. Use `std::ffi::CString`/`CStr` for conversion. Never pass a Rust `&str` directly to a C function expecting `char*`.
- **Opaque C types**: use a struct with `PhantomData<(*mut u8, PhantomPinned)>` and a private field to prevent construction outside the module and disable `Send`/`Sync`/`Unpin`.
- **Thread safety**: C libraries may not be thread-safe. Check documentation and add your own synchronization (`Mutex`, etc.) as needed.
- **Asynchronous callbacks**: use `mpsc` channels or `Mutex` to forward data from C-spawned threads to Rust threads safely. Unregister callbacks in destructors to prevent use-after-free.
- Use `rust-bindgen` (C → Rust) or `cbindgen` (Rust → C) to auto-generate binding code and reduce hand-written `unsafe extern` blocks.

## Related

- [data-layout.md](./data-layout.md)
- [conversions.md](./conversions.md)
- [unwinding.md](./unwinding.md)
- [beneath-std.md](./beneath-std.md)
