# Installation

Setting up the embedded Rust toolchain requires: a Rust cross-compilation target, cargo utilities, and platform-specific tools (debugger, QEMU).

## Rust Toolchain

```bash
# Install rustup from https://rustup.rs, then verify
rustc -V  # must be >= 1.31

# Add cross-compilation target (choose by Cortex-M variant)
rustup target add thumbv6m-none-eabi      # Cortex-M0, M0+, M1 (ARMv6-M)
rustup target add thumbv7m-none-eabi      # Cortex-M3 (ARMv7-M)
rustup target add thumbv7em-none-eabi     # Cortex-M4, M7 without FPU (ARMv7E-M)
rustup target add thumbv7em-none-eabihf   # Cortex-M4F, M7F with FPU (recommended for STM32F3)
rustup target add thumbv8m.base-none-eabi  # Cortex-M23 (ARMv8-M)
rustup target add thumbv8m.main-none-eabi  # Cortex-M33, M35P (ARMv8-M)
rustup target add thumbv8m.main-none-eabihf # Cortex-M33F, M35PF with FPU
```

## cargo-binutils

```bash
cargo install cargo-binutils
rustup component add llvm-tools
```

Provides `cargo-objcopy`, `cargo-objdump`, `cargo-size`, etc. Windows requires C++ Build Tools for Visual Studio 2019.

## cargo-generate

```bash
cargo install cargo-generate
```

Used to create new projects from templates. Linux may require `libssl-dev` and `pkg-config` first.

## OS-Specific Tools

### Linux
- Install `gdb-multiarch`, `openocd`, `qemu-system-arm` via package manager
- Add udev rules for USB debugger access

### macOS
```bash
# Homebrew
brew install armmbed/formulae/arm-none-eabi-gcc openocd qemu

# MacPorts
port install arm-none-eabi-gcc openocd qemu
```

### Windows
- Install `arm-none-eabi-gdb` from ARM GNU toolchain
- Install OpenOCD and QEMU binaries
- Install ST-LINK USB driver for STM32 boards

## Verify Installation

```bash
cargo new --bin app && cd app
# Add .cargo/config.toml with target and runner settings
cargo build --target thumbv7em-none-eabihf
```

## Notes

- The `thumbv7em-none-eabihf` target is recommended for the STM32F3DISCOVERY board
- `cargo-binutils` replaces the need for separate `arm-none-eabi-binutils`

## Related

- [intro.md](./intro.md)
- [no-std.md](./no-std.md)
