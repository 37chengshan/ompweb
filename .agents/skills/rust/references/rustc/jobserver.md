# Jobserver

`rustc` uses the GNU Make jobserver protocol to coordinate parallel compilation with build systems. When a jobserver is available, `rustc` respects it for spawning parallel work internally.

## Overview

The jobserver token pool is passed via the `MAKEFLAGS` environment variable. If no jobserver is available, `rustc` determines its own parallelism. Since Rust 1.76.0, a warning is emitted when a jobserver is detected in the environment but cannot be accessed.

## Warning Example

```bash
$ echo 'fn main() {}' | MAKEFLAGS=--jobserver-auth=3,4 rustc -
warning: failed to connect to jobserver from environment variable `MAKEFLAGS="--jobserver-auth=3,4"`: cannot open file descriptor 3 from the jobserver environment variable value: Bad file descriptor (os error 9)
```

## Build System Integration

### GNU Make

Mark `rustc` invocations as recursive using the `+` prefix so Make passes the jobserver:

```makefile
all:
	+rustc hello.rs
```

For `$(shell ...)` calls, clear `MAKEFLAGS` to avoid forwarding a jobserver that won't be accessible:

```makefile
output := $(shell env MAKEFLAGS= rustc --print=sysroot)
```

### CMake

CMake 3.28+ supports `JOB_SERVER_AWARE TRUE` in `add_custom_target`:

```cmake
add_custom_target(build_rust
    JOB_SERVER_AWARE TRUE
    COMMAND rustc hello.rs
)
```

For earlier CMake versions, use `$(MAKE)` in the command to trigger GNU Make's recursive behavior and inherit the jobserver.

## Notes

- The jobserver is inherited through `MAKEFLAGS` only; `rustc` does not search other environment variables.
- Cargo automatically manages jobserver integration when invoking `rustc`; manual configuration is only needed for custom build systems.

## Related

- [Command-line Arguments](./command-line-arguments.md)
- [Codegen Options](./codegen-options.md)
