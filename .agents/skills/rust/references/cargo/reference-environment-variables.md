# Environment Variables

Cargo reads environment variables to configure its behavior and sets variables for crates and build scripts at compile time.

## Variables Cargo Reads

### Core Configuration

| Variable | Description |
|----------|-------------|
| `CARGO_HOME` | Local cache directory (default: `~/.cargo`) |
| `CARGO_TARGET_DIR` | Output artifact directory (relative to CWD) |
| `CARGO` | Path to the cargo binary |
| `RUSTC` | Rust compiler binary to use instead of `rustc` |
| `RUSTC_WRAPPER` | Wrapper around all `rustc` invocations (e.g., `sccache`) |
| `RUSTC_WORKSPACE_WRAPPER` | Wrapper for workspace member compilations only |
| `RUSTDOC` | Documentation generator binary |
| `RUSTFLAGS` | Space-separated extra flags for all `rustc` invocations |
| `CARGO_ENCODED_RUSTFLAGS` | Same as `RUSTFLAGS` but `0x1f`-separated (for flags with spaces) |
| `RUSTDOCFLAGS` | Extra flags for all `rustdoc` invocations |
| `CARGO_ENCODED_RUSTDOCFLAGS` | Same as `RUSTDOCFLAGS` but `0x1f`-separated |

### Compilation Control

| Variable | Description |
|----------|-------------|
| `CARGO_INCREMENTAL` | `1` to enable, `0` to disable incremental compilation |
| `CARGO_LOG` | Debug log level (`trace`, `debug`, `warn`, etc.) |
| `CARGO_CACHE_RUSTC_INFO` | Set to `0` to disable compiler version caching |

### Network and HTTP

| Variable | Description |
|----------|-------------|
| `HTTPS_PROXY` / `https_proxy` | HTTP proxy settings |
| `HTTP_TIMEOUT` | HTTP timeout in seconds |

### Configuration Key Overrides (`CARGO_*`)

Config keys from `.cargo/config.toml` can be overridden via environment:

```bash
CARGO_BUILD_JOBS=4
CARGO_BUILD_TARGET=aarch64-unknown-linux-gnu
CARGO_HTTP_TIMEOUT=60
CARGO_NET_OFFLINE=true
CARGO_REGISTRY_TOKEN=mytoken
CARGO_REGISTRIES_MY_REGISTRY_TOKEN=mytoken
CARGO_TERM_COLOR=always
CARGO_PROFILE_RELEASE_OPT_LEVEL=3
CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER=aarch64-linux-gnu-gcc
```

## Variables Cargo Sets for Crates

Available via `env!()` macro or `std::env::var()`:

```rust
let version = env!("CARGO_PKG_VERSION");
let name = env!("CARGO_PKG_NAME");
```

### Package Information

| Variable | Description |
|----------|-------------|
| `CARGO_PKG_VERSION` | Full version string |
| `CARGO_PKG_VERSION_MAJOR` | Major version component |
| `CARGO_PKG_VERSION_MINOR` | Minor version component |
| `CARGO_PKG_VERSION_PATCH` | Patch version component |
| `CARGO_PKG_VERSION_PRE` | Pre-release component |
| `CARGO_PKG_NAME` | Package name |
| `CARGO_PKG_AUTHORS` | Colon-separated authors |
| `CARGO_PKG_DESCRIPTION` | Package description |
| `CARGO_PKG_HOMEPAGE` | Homepage URL |
| `CARGO_PKG_REPOSITORY` | Repository URL |
| `CARGO_PKG_LICENSE` | License expression |
| `CARGO_PKG_README` | Path to README file |

### Build Paths

| Variable | Description |
|----------|-------------|
| `CARGO` | Path to cargo binary |
| `CARGO_MANIFEST_DIR` | Directory containing `Cargo.toml` |
| `CARGO_MANIFEST_PATH` | Full path to `Cargo.toml` |
| `CARGO_CRATE_NAME` | Crate name (`-` converted to `_`) |
| `CARGO_BIN_NAME` | Binary name (binary/example targets only) |

## Variables Cargo Sets for Build Scripts

Available via `std::env::var()` in `build.rs`:

```rust
let out_dir = std::env::var("OUT_DIR").unwrap();
let target = std::env::var("TARGET").unwrap();
```

### Essential Build Script Variables

| Variable | Description |
|----------|-------------|
| `OUT_DIR` | Directory where build script should write output |
| `TARGET` | Target triple being compiled for |
| `HOST` | Host triple (where Cargo is running) |
| `CARGO_MANIFEST_DIR` | Package source directory |
| `PROFILE` | `release` or `debug` |
| `DEBUG` | `true` if debug info is being generated |
| `OPT_LEVEL` | Optimization level (`0`–`3`, `s`, `z`) |
| `NUM_JOBS` | Parallelism level |
| `CARGO_MAKEFLAGS` | GNU Make jobserver parameters |

### Feature and Configuration Variables

| Variable | Description |
|----------|-------------|
| `CARGO_FEATURE_<NAME>` | Set for each active feature (uppercase, `-` → `_`) |
| `CARGO_CFG_UNIX` / `CARGO_CFG_WINDOWS` | Target OS family |
| `CARGO_CFG_TARGET_OS` | Target OS (e.g., `macos`, `linux`) |
| `CARGO_CFG_TARGET_ARCH` | Target architecture (e.g., `x86_64`, `aarch64`) |
| `CARGO_CFG_TARGET_FAMILY` | `unix` or `windows` |
| `CARGO_CFG_TARGET_ENDIAN` | `little` or `big` |
| `CARGO_CFG_TARGET_POINTER_WIDTH` | Pointer size in bits (e.g., `64`) |

### Compiler Paths

| Variable | Description |
|----------|-------------|
| `RUSTC` | Resolved `rustc` path |
| `RUSTDOC` | Resolved `rustdoc` path |
| `RUSTC_WRAPPER` | Active rustc wrapper |
| `RUSTC_LINKER` | Linker binary |
| `CARGO_ENCODED_RUSTFLAGS` | Extra rustc flags (`0x1f`-separated) |

## Variables for Integration Tests

| Variable | Description |
|----------|-------------|
| `CARGO_BIN_EXE_<name>` | Absolute path to compiled binary (integration tests/benchmarks only) |

## Dynamic Library Path Variables

Cargo sets these so tests and examples can find shared libraries:

| Platform | Variable |
|----------|----------|
| Windows | `PATH` |
| macOS | `DYLD_FALLBACK_LIBRARY_PATH` |
| Unix/Linux | `LD_LIBRARY_PATH` |
| AIX | `LIBPATH` |

## Notes

- Do NOT use `cfg!()` or `#[cfg()]` in build scripts — they reflect the **host**, not the target. Use `CARGO_CFG_*` variables instead.
- `RUSTFLAGS` is applied to all crates; use `CARGO_ENCODED_RUSTFLAGS` when flags contain spaces.
- Build script variables like `TARGET` are NOT available in regular crate compilation.

## Related

- [reference-config.md](./reference-config.md)
- [reference-build-scripts.md](./reference-build-scripts.md)
