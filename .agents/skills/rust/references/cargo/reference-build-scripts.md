# Build Scripts

Build scripts are Rust programs that run before the package is compiled. They integrate C libraries, generate code, and perform platform-specific configuration.

## Basic Setup

Place `build.rs` in the package root (or specify a custom path with `build = "path/to/build.rs"` in `Cargo.toml`):

```rust
// build.rs
fn main() {
    println!("cargo::rerun-if-changed=src/config.h");
    // build logic here
}
```

Declare build-time dependencies:

```toml
[build-dependencies]
cc = "1.0"
```

## Lifecycle

1. Cargo compiles `build.rs` (cached unless inputs changed)
2. Build script runs before the package compiles
3. Script communicates with Cargo via `println!("cargo::INSTRUCTION")`
4. Non-zero exit code halts the entire build

Output is saved to `target/debug/build/<pkg>/output`. View it with `cargo build -vv`.

## Cargo Instructions (stdout)

Instructions use the format `cargo::KEY=VALUE` (Rust 1.77+; older syntax: `cargo:KEY=VALUE`).

### Change Detection

```rust
// Rerun if file changes (checked by mtime)
println!("cargo::rerun-if-changed=src/config.h");
println!("cargo::rerun-if-changed=build.rs");

// Rerun if environment variable changes
println!("cargo::rerun-if-env-changed=CC");
```

If no `rerun-if-changed` is emitted, the build script reruns on every build.

### Linking

```rust
// Link a library
println!("cargo::rustc-link-lib=foo");            // default (dylib on most platforms)
println!("cargo::rustc-link-lib=static=mylib");   # static
println!("cargo::rustc-link-lib=dylib=bar");      # dynamic
println!("cargo::rustc-link-lib=framework=CoreFoundation");  # macOS framework

// Add library search path
println!("cargo::rustc-link-search=/path/to/libs");
println!("cargo::rustc-link-search=native=/usr/local/lib");

// Pass custom linker flags
println!("cargo::rustc-link-arg=-Wl,--version-script=version.txt");
println!("cargo::rustc-link-arg-bins=-fuse-ld=lld");  // only for binaries
```

### Compiler Configuration

```rust
// Set cfg flags for conditional compilation
println!("cargo::rustc-cfg=my_feature");
println!("cargo::rustc-cfg=backend=\"openssl\"");

// Register expected cfg names/values (avoids unexpected_cfgs lint)
println!("cargo::rustc-check-cfg=cfg(my_feature, values(none()))");
println!("cargo::rustc-check-cfg=cfg(backend, values(\"openssl\", \"native\"))");

// Set compile-time environment variables (accessible via env!())
println!("cargo::rustc-env=GIT_COMMIT=abc123");
```

In source code:

```rust
#[cfg(my_feature)]
fn use_my_feature() {}

const GIT_HASH: &str = env!("GIT_COMMIT");
```

### Messages

```rust
println!("cargo::warning=Library version may be outdated");
println!("cargo::error=Required library libfoo not found");  // Rust 1.84+
```

Warnings only show for `path` dependencies during local development (use `-vv` to see all).

### Metadata (for dependent packages)

```rust
// Pass data to build scripts of packages that depend on this one
println!("cargo::metadata=version=2.0");  // Rust 1.77+
```

Dependents receive this as `DEP_<LINKS_VALUE>_<KEY>` environment variables.

## Build Script Inputs (Environment Variables)

```rust
use std::env;

let out_dir = env::var("OUT_DIR").unwrap();    // write generated files here
let target = env::var("TARGET").unwrap();       // target triple
let host = env::var("HOST").unwrap();           // host triple
let profile = env::var("PROFILE").unwrap();     // "release" or "debug"
let opt_level = env::var("OPT_LEVEL").unwrap(); // "0" | "1" | "2" | "3" | "s" | "z"

// Feature detection
if env::var("CARGO_FEATURE_STD").is_ok() {
    // "std" feature is enabled
}

// Target configuration (use these, NOT cfg!())
let target_os = env::var("CARGO_CFG_TARGET_OS").unwrap();
let target_arch = env::var("CARGO_CFG_TARGET_ARCH").unwrap();
```

## Linking to System Libraries (the `-sys` Convention)

Packages linking to native libraries use the `links` key:

```toml
[package]
name = "libfoo-sys"
links = "foo"   # declares this package links to native libfoo
```

The `links` key:
- Ensures at most one package links to a given native library (prevents duplicate symbols)
- Allows passing metadata between `-sys` crates via `DEP_<LINKS>_<KEY>` environment variables
- Enables config-level build script override

**Override via config** (skips running the build script):

```toml
# .cargo/config.toml
[target.x86_64-unknown-linux-gnu.foo]
rustc-link-lib = ["foo"]
rustc-link-search = ["/usr/lib"]
rustc-env = { FOO_VERSION = "2.0" }
```

## Example: Compiling a C Library

```rust
// build.rs
fn main() {
    println!("cargo::rerun-if-changed=src/hello.c");
    cc::Build::new()
        .file("src/hello.c")
        .compile("hello");
}
```

```toml
[build-dependencies]
cc = "1.0"
```

## Notes

- Build scripts only access `[build-dependencies]`, not `[dependencies]`.
- `OUT_DIR` is not cleaned between builds; scripts must manage their own cleanup if needed.
- The order of `cargo::` instructions affects the order of arguments to `rustc`/linker.
- Use `cargo::rustc-check-cfg` for every custom cfg to avoid the `unexpected_cfgs` lint (required since Rust 1.80).
- Do NOT use `cfg!()` or `#[cfg()]` in build scripts — they check the **host**, not the target. Use `CARGO_CFG_*` env vars instead.
- Build script output is invisible by default; use `cargo build -vv` to see it.

## Related

- [reference-environment-variables.md](./reference-environment-variables.md)
- [reference-manifest.md](./reference-manifest.md)
- [reference-config.md](./reference-config.md)
