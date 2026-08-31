# embedded

| Name | Description | Path |
|------|-------------|------|
| Appendix | Reference material, glossary, and links to further resources for embedded Rust development. | [appendix.md](./appendix.md) |
| Collections | In `no_std` embedded environments, the standard collections (`Vec`, `HashMap`, etc.) from `std` are… | [collections.md](./collections.md) |
| Concurrency | Embedded concurrency arises from interrupt handlers, which run asynchronously alongside the main loop. | [concurrency.md](./concurrency.md) |
| Design Patterns | This chapter collects patterns recommended for embedded Rust, with a focus on HAL (Hardware… | [design-patterns.md](./design-patterns.md) |
| Installation | Setting up the embedded Rust toolchain requires: a Rust cross-compilation target, cargo utilities,… | [installation.md](./installation.md) |
| Interoperability (FFI with C) | Embedded Rust projects often need to call existing C libraries (vendor SDKs, RTOSes) or expose… | [interoperability.md](./interoperability.md) |
| Introduction | The Embedded Rust Book is an introductory guide to using Rust on bare-metal embedded systems,… | [intro.md](./intro.md) |
| Memory-Mapped Registers | Peripherals on microcontrollers are accessed by reading/writing specific memory addresses. | [memory-mapped-registers.md](./memory-mapped-registers.md) |
| no_std Environment | `#![no_std]` is a crate-level attribute that links against `core` instead of `std`. | [no-std.md](./no-std.md) |
| Peripherals | Peripherals are hardware blocks on a microcontroller that handle external interactions (sensors,… | [peripherals.md](./peripherals.md) |
| Portability | Embedded hardware varies greatly across vendors. `embedded-hal` provides a trait-based Hardware… | [portability.md](./portability.md) |
| Static Guarantees | Rust's type system can encode hardware state, enforcing correct peripheral usage at compile time… | [static-guarantees.md](./static-guarantees.md) |
| Tips for Embedded C Developers | Key Rust idioms and their C equivalents for developers migrating from C-based embedded… | [tips-for-embedded-c-devs.md](./tips-for-embedded-c-devs.md) |
| Unsorted Topics | Miscellaneous topics that don't fit cleanly into other chapters, including optimization… | [unsorted.md](./unsorted.md) |
