# Appendix

Reference material, glossary, and links to further resources for embedded Rust development.

## Glossary

| Term | Definition |
|------|------------|
| **ARM Cortex-M** | Family of 32-bit RISC processor cores widely used in microcontrollers (M0, M3, M4, M7, M33, etc.) |
| **Bare Metal** | Programming environment with no OS; code runs directly on hardware |
| **Board Crate** | Crate providing pre-configured peripherals and pins for a specific development board |
| **cortex-m** | Rust crate providing low-level access to Cortex-M processor core peripherals (SysTick, NVIC, etc.) |
| **cortex-m-rt** | Rust crate providing the minimal runtime for Cortex-M: startup code, `#[entry]`, interrupt handlers |
| **embedded-hal** | Trait collection defining standard interfaces for embedded hardware (GPIO, SPI, I2C, etc.) |
| **Flash** | Non-volatile memory where firmware (code + read-only data) is stored |
| **HAL** | Hardware Abstraction Layer — software layer hiding hardware details behind a portable API |
| **Hosted Environment** | Embedded environment with an OS providing syscalls (e.g., Raspberry Pi with Linux) |
| **linker script** | File controlling how the linker places code and data in memory regions |
| **no_std** | Rust mode that excludes `std`; links against `core` instead |
| **OpenOCD** | Open On-Chip Debugger — software bridge between GDB and hardware debug probes |
| **PAC** | Peripheral Access Crate — auto-generated thin wrappers around memory-mapped registers |
| **probe-rs** | Modern Rust-native debugging tool replacing OpenOCD for many targets |
| **QEMU** | CPU emulator; used to run embedded firmware without physical hardware |
| **RAM** | Volatile memory for stack, heap, and `static mut` variables |
| **RTIC** | Real Time Interrupt-driven Concurrency — Rust framework for safe, zero-overhead embedded concurrency |
| **RTOS** | Real-Time Operating System (FreeRTOS, ChibiOS, Zephyr, etc.) |
| **semihosting** | Mechanism for embedded targets to use host I/O (stdout, filesystem) via debugger |
| **SVD** | System View Description — XML file describing a microcontroller's registers; input to `svd2rust` |
| **svd2rust** | Tool generating PAC crates from SVD files |
| **Typestate** | Design pattern encoding object state into its type for compile-time enforcement |

## Rust Target Triples for Embedded

| Target Triple | Architecture | Notes |
|---------------|-------------|-------|
| `thumbv6m-none-eabi` | ARMv6-M | Cortex-M0, M0+, M1 |
| `thumbv7m-none-eabi` | ARMv7-M | Cortex-M3 |
| `thumbv7em-none-eabi` | ARMv7E-M | Cortex-M4, M7 (no FPU) |
| `thumbv7em-none-eabihf` | ARMv7E-M + FPU | Cortex-M4F, M7F |
| `thumbv8m.base-none-eabi` | ARMv8-M Baseline | Cortex-M23 |
| `thumbv8m.main-none-eabi` | ARMv8-M Mainline | Cortex-M33, M35P |
| `thumbv8m.main-none-eabihf` | ARMv8-M + FPU | Cortex-M33F, M35PF |
| `riscv32imac-unknown-none-elf` | RISC-V 32-bit | GD32VF103, etc. |

## Key Crates

| Crate | Purpose |
|-------|---------|
| `cortex-m` | Cortex-M processor core peripherals |
| `cortex-m-rt` | Startup code, `#[entry]`, exception/interrupt vectors |
| `embedded-hal` | Portable hardware trait definitions |
| `heapless` | Fixed-capacity collections without a heap |
| `panic-halt` | Minimal panic handler (infinite loop) |
| `panic-semihosting` | Panic handler that prints via semihosting |
| `volatile-register` | `RW<T>` / `RO<T>` / `WO<T>` types for register access |
| `nb` | Non-blocking API traits for embedded drivers |
| `rtic` | Real-time interrupt-driven concurrency framework |

## Further Reading

- [The Embedonomicon](https://docs.rust-embedded.org/embedonomicon/) — deep dive into startup, linker scripts, and runtime
- [The Discovery Book](https://docs.rust-embedded.org/discovery/) — beginner project-based guide with STM32F3
- [Comprehensive Rust: Bare Metal](https://google.github.io/comprehensive-rust/bare-metal.html) — Google's embedded Rust course
- [RTIC Book](https://rtic.rs) — RTIC framework documentation
- [probe-rs](https://probe.rs) — modern Rust debugging toolchain
- [Embedded Rust FAQ](https://docs.rust-embedded.org/faq.html)

## Related

- [intro.md](./intro.md)
- [installation.md](./installation.md)
